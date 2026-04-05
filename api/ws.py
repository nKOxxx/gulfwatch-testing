#!/usr/bin/env python3
"""
Gulf Watch v2 -- WebSocket Server
Author: Rena Oduya, Backend Core

Real-time push of incidents, alerts, and thermal detections to authenticated
clients. Subscribes to Redis pub/sub channels and fans out to connected
WebSocket clients based on their channel subscriptions.

Architecture contract (Section 5.7):
    - Connection: wss://api.gulfwatch.io/ws?token=<access_token>
    - Server -> Client: incident.new, incident.update, alert.threat,
                        module.update, thermal.new, heartbeat
    - Client -> Server: subscribe, unsubscribe, pong
    - Heartbeat: 30s interval, 10s timeout for pong response

Environment:
    GW_REDIS_URL           Redis URL (default: redis://localhost:6379)
    GW_WS_HOST             Bind host (default: 0.0.0.0)
    GW_WS_PORT             Bind port (default: 8765)
    GW_JWT_PUBLIC_KEY_PATH Path to RSA public key for JWT verification
    GW_JWT_ALGORITHM       JWT algorithm (default: RS256)
    GW_WS_MAX_CONNECTIONS  Maximum concurrent connections (default: 1000)
"""

import asyncio
import json
import logging
import os
import signal
import sys
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, Optional, Set

import jwt
import redis.asyncio as aioredis
import websockets
from websockets.exceptions import ConnectionClosed, ConnectionClosedOK

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=os.environ.get("GW_LOG_LEVEL", "INFO"),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("gulfwatch.ws")

REDIS_URL = os.environ.get("GW_REDIS_URL", "redis://localhost:6379/0")
WS_HOST = os.environ.get("GW_WS_HOST", "0.0.0.0")
WS_PORT = int(os.environ.get("GW_WS_PORT", "8765"))
MAX_CONNECTIONS = int(os.environ.get("GW_WS_MAX_CONNECTIONS", "1000"))

JWT_PUBLIC_KEY_PATH = os.environ.get("GW_JWT_PUBLIC_KEY_PATH", "")
JWT_ALGORITHM = os.environ.get("GW_JWT_ALGORITHM", "RS256")

HEARTBEAT_INTERVAL = 30  # seconds
HEARTBEAT_TIMEOUT = 10   # seconds to wait for pong

# Valid subscription channels
VALID_CHANNELS = {"incidents", "alerts", "thermal", "modules"}

# Redis channel name mapping
REDIS_CHANNELS = {
    "incidents": "channel:incidents",
    "alerts": "channel:alerts",
    "thermal": "channel:thermal",
    "modules": "channel:module-updates",
}

# Rate limits per role (outbound messages per minute)
RATE_LIMITS = {
    "viewer": 10,
    "analyst": 30,
    "admin": float("inf"),
}


# ---------------------------------------------------------------------------
# JWT Authentication
# ---------------------------------------------------------------------------

_jwt_public_key: Optional[str] = None


def _load_jwt_public_key() -> str:
    """Load JWT public key from file or environment."""
    global _jwt_public_key
    if _jwt_public_key is not None:
        return _jwt_public_key

    if JWT_PUBLIC_KEY_PATH and Path(JWT_PUBLIC_KEY_PATH).exists():
        _jwt_public_key = Path(JWT_PUBLIC_KEY_PATH).read_text()
    else:
        # Fallback: try environment variable
        _jwt_public_key = os.environ.get("GW_JWT_PUBLIC_KEY", "")

    if not _jwt_public_key:
        logger.warning(
            "No JWT public key configured. "
            "Set GW_JWT_PUBLIC_KEY_PATH or GW_JWT_PUBLIC_KEY."
        )
    return _jwt_public_key


def verify_token(token: str) -> Optional[Dict]:
    """Verify a JWT access token and return the payload.
    Returns None if invalid."""
    public_key = _load_jwt_public_key()
    if not public_key:
        # In development without key, accept a dev token format
        if os.environ.get("NODE_ENV") == "development":
            logger.warning("Dev mode: skipping JWT verification")
            return {"sub": "dev-user", "role": "admin"}
        return None

    try:
        payload = jwt.decode(
            token,
            public_key,
            algorithms=[JWT_ALGORITHM],
            options={
                "require": ["sub", "role", "exp"],
                "verify_exp": True,
            },
        )
        return payload
    except jwt.ExpiredSignatureError:
        logger.debug("JWT expired")
        return None
    except jwt.InvalidTokenError as exc:
        logger.debug("Invalid JWT: %s", exc)
        return None


# ---------------------------------------------------------------------------
# Client Connection
# ---------------------------------------------------------------------------

@dataclass
class ClientConnection:
    """Represents an authenticated WebSocket client."""
    conn_id: str = field(default_factory=lambda: str(uuid.uuid4())[:8])
    websocket: Any = None
    user_id: str = ""
    user_role: str = "viewer"
    subscriptions: Set[str] = field(default_factory=set)
    last_pong: float = field(default_factory=time.time)
    message_count: int = 0
    message_window_start: float = field(default_factory=time.time)
    created_at: float = field(default_factory=time.time)

    @property
    def rate_limit(self) -> float:
        return RATE_LIMITS.get(self.user_role, 10)

    def check_rate_limit(self) -> bool:
        """Check if the client is within its outbound message rate limit.
        Returns True if the message can be sent."""
        now = time.time()
        if now - self.message_window_start >= 60:
            self.message_count = 0
            self.message_window_start = now
        if self.message_count >= self.rate_limit:
            return False
        self.message_count += 1
        return True


# ---------------------------------------------------------------------------
# Connection Manager
# ---------------------------------------------------------------------------

class ConnectionManager:
    """Manages all active WebSocket client connections."""

    def __init__(self):
        self._clients: Dict[str, ClientConnection] = {}
        self._lock = asyncio.Lock()

    @property
    def count(self) -> int:
        return len(self._clients)

    async def add(self, client: ClientConnection) -> None:
        async with self._lock:
            self._clients[client.conn_id] = client
        logger.info(
            "Client connected: %s (user=%s, role=%s). Total: %d",
            client.conn_id, client.user_id, client.user_role, self.count,
        )

    async def remove(self, conn_id: str) -> None:
        async with self._lock:
            self._clients.pop(conn_id, None)
        logger.info("Client disconnected: %s. Total: %d", conn_id, self.count)

    async def get_subscribers(self, channel: str) -> list:
        """Get all clients subscribed to a channel."""
        async with self._lock:
            return [
                c for c in self._clients.values()
                if channel in c.subscriptions
            ]

    async def get_all(self) -> list:
        async with self._lock:
            return list(self._clients.values())

    async def broadcast(self, channel: str, message: str) -> int:
        """Broadcast a message to all subscribers of a channel.
        Returns number of clients the message was sent to."""
        subscribers = await self.get_subscribers(channel)
        sent = 0
        for client in subscribers:
            if not client.check_rate_limit():
                continue
            try:
                await client.websocket.send(message)
                sent += 1
            except ConnectionClosed:
                await self.remove(client.conn_id)
            except Exception as exc:
                logger.warning(
                    "Failed to send to %s: %s", client.conn_id, exc,
                )
        return sent


# ---------------------------------------------------------------------------
# Redis Subscriber
# ---------------------------------------------------------------------------

class RedisSubscriber:
    """Subscribes to Redis pub/sub channels and dispatches to the
    ConnectionManager for fan-out."""

    def __init__(self, manager: ConnectionManager, redis_url: str = REDIS_URL):
        self._manager = manager
        self._redis_url = redis_url
        self._client: Optional[aioredis.Redis] = None
        self._pubsub: Optional[aioredis.client.PubSub] = None
        self._running = False

    async def connect(self) -> None:
        self._client = aioredis.from_url(
            self._redis_url,
            decode_responses=True,
            socket_connect_timeout=5,
        )
        await self._client.ping()
        logger.info("Redis subscriber connected: %s", self._redis_url)

    async def subscribe_and_listen(self) -> None:
        """Subscribe to all channels and dispatch messages."""
        if not self._client:
            await self.connect()

        self._pubsub = self._client.pubsub()
        await self._pubsub.subscribe(
            *[ch for ch in REDIS_CHANNELS.values()]
        )

        self._running = True
        logger.info(
            "Redis subscribed to channels: %s",
            ", ".join(REDIS_CHANNELS.values()),
        )

        # Reverse mapping: redis channel -> our channel name
        reverse_map = {v: k for k, v in REDIS_CHANNELS.items()}

        try:
            async for raw_msg in self._pubsub.listen():
                if not self._running:
                    break
                if raw_msg["type"] != "message":
                    continue

                redis_channel = raw_msg["channel"]
                our_channel = reverse_map.get(redis_channel)
                if not our_channel:
                    continue

                data = raw_msg["data"]
                sent = await self._manager.broadcast(our_channel, data)
                if sent > 0:
                    logger.debug(
                        "Broadcast %s -> %d clients", our_channel, sent,
                    )
        except asyncio.CancelledError:
            pass
        except Exception as exc:
            logger.error("Redis listener error: %s", exc)
        finally:
            await self.close()

    async def close(self) -> None:
        self._running = False
        if self._pubsub:
            await self._pubsub.unsubscribe()
            await self._pubsub.close()
            self._pubsub = None
        if self._client:
            await self._client.close()
            self._client = None


# ---------------------------------------------------------------------------
# Heartbeat Monitor
# ---------------------------------------------------------------------------

async def heartbeat_loop(manager: ConnectionManager):
    """Send heartbeats to all clients every 30 seconds.
    Disconnect clients that don't respond within 10 seconds."""
    while True:
        try:
            await asyncio.sleep(HEARTBEAT_INTERVAL)
            now = time.time()

            clients = await manager.get_all()
            for client in clients:
                # Check if client missed the previous heartbeat
                if now - client.last_pong > HEARTBEAT_INTERVAL + HEARTBEAT_TIMEOUT:
                    logger.info(
                        "Client %s timed out (no pong in %ds), disconnecting.",
                        client.conn_id,
                        int(now - client.last_pong),
                    )
                    try:
                        await client.websocket.close(4008, "Heartbeat timeout")
                    except Exception:
                        pass
                    await manager.remove(client.conn_id)
                    continue

                # Send heartbeat
                try:
                    hb = json.dumps({
                        "type": "heartbeat",
                        "data": {"ts": int(now)},
                    })
                    await client.websocket.send(hb)
                except ConnectionClosed:
                    await manager.remove(client.conn_id)
                except Exception as exc:
                    logger.warning(
                        "Heartbeat send failed for %s: %s",
                        client.conn_id, exc,
                    )
        except asyncio.CancelledError:
            break
        except Exception as exc:
            logger.error("Heartbeat loop error: %s", exc)
            await asyncio.sleep(5)


# ---------------------------------------------------------------------------
# WebSocket Handler
# ---------------------------------------------------------------------------

async def ws_handler(
    websocket,
    manager: ConnectionManager,
):
    """Handle a single WebSocket connection."""

    # ---- Authentication ----
    # Token comes from query string: ?token=<jwt>
    path = websocket.request.path if hasattr(websocket, 'request') else ""
    query = ""
    if hasattr(websocket, 'request') and hasattr(websocket.request, 'query_string'):
        query = websocket.request.query_string
    elif "?" in str(getattr(websocket, 'path', '')):
        query = str(getattr(websocket, 'path', '')).split("?", 1)[1]

    # Parse token from query params
    token = None
    for param in query.split("&"):
        if param.startswith("token="):
            token = param[6:]
            break

    if not token:
        # Also check headers
        headers = getattr(websocket, 'request_headers', {})
        auth_header = headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]

    if not token:
        await websocket.close(4001, "Authentication required")
        return

    payload = verify_token(token)
    if payload is None:
        await websocket.close(4003, "Invalid or expired token")
        return

    # Check connection limit
    if manager.count >= MAX_CONNECTIONS:
        await websocket.close(4029, "Too many connections")
        return

    # ---- Create client ----
    client = ClientConnection(
        websocket=websocket,
        user_id=payload.get("sub", ""),
        user_role=payload.get("role", "viewer"),
    )
    # Default subscriptions: incidents
    client.subscriptions.add("incidents")

    await manager.add(client)

    try:
        async for raw_msg in websocket:
            try:
                msg = json.loads(raw_msg)
            except (json.JSONDecodeError, TypeError):
                await websocket.send(json.dumps({
                    "type": "error",
                    "data": {"message": "Invalid JSON"},
                }))
                continue

            msg_type = msg.get("type")

            if msg_type == "pong":
                client.last_pong = time.time()

            elif msg_type == "subscribe":
                channels = msg.get("channels", [])
                for ch in channels:
                    if ch in VALID_CHANNELS:
                        client.subscriptions.add(ch)
                    else:
                        await websocket.send(json.dumps({
                            "type": "error",
                            "data": {
                                "message": f"Unknown channel: {ch}",
                                "valid_channels": sorted(VALID_CHANNELS),
                            },
                        }))
                logger.debug(
                    "Client %s subscribed to: %s",
                    client.conn_id, client.subscriptions,
                )

            elif msg_type == "unsubscribe":
                channels = msg.get("channels", [])
                for ch in channels:
                    client.subscriptions.discard(ch)
                logger.debug(
                    "Client %s unsubscribed, remaining: %s",
                    client.conn_id, client.subscriptions,
                )

            elif msg_type == "ping":
                # Client-initiated ping
                await websocket.send(json.dumps({
                    "type": "pong",
                    "data": {"ts": int(time.time())},
                }))

            else:
                await websocket.send(json.dumps({
                    "type": "error",
                    "data": {
                        "message": f"Unknown message type: {msg_type}",
                        "valid_types": ["subscribe", "unsubscribe", "pong", "ping"],
                    },
                }))

    except ConnectionClosedOK:
        pass
    except ConnectionClosed as exc:
        logger.debug("Client %s disconnected: %s", client.conn_id, exc)
    except Exception as exc:
        logger.error("Handler error for %s: %s", client.conn_id, exc)
    finally:
        await manager.remove(client.conn_id)


# ---------------------------------------------------------------------------
# Server
# ---------------------------------------------------------------------------

async def run_server():
    """Start the WebSocket server, Redis subscriber, and heartbeat loop."""
    manager = ConnectionManager()

    # Start Redis subscriber
    redis_sub = RedisSubscriber(manager, REDIS_URL)
    try:
        await redis_sub.connect()
    except Exception as exc:
        logger.warning("Redis connection failed (will retry): %s", exc)

    # Create tasks
    redis_task = asyncio.create_task(redis_sub.subscribe_and_listen())
    heartbeat_task = asyncio.create_task(heartbeat_loop(manager))

    # Define the handler with manager injected
    async def handler(websocket):
        await ws_handler(websocket, manager)

    # Start WebSocket server
    logger.info("Starting WebSocket server on %s:%d", WS_HOST, WS_PORT)
    logger.info("Max connections: %d", MAX_CONNECTIONS)

    stop = asyncio.Future()

    # Handle shutdown signals
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, stop.set_result, None)

    async with websockets.serve(
        handler,
        WS_HOST,
        WS_PORT,
        max_size=2**20,          # 1MB max message size
        ping_interval=None,       # We handle heartbeats ourselves
        ping_timeout=None,
        close_timeout=10,
        max_queue=64,
    ):
        logger.info("WebSocket server running.")
        await stop

    # Cleanup
    logger.info("Shutting down WebSocket server...")
    heartbeat_task.cancel()
    redis_task.cancel()
    await redis_sub.close()

    try:
        await heartbeat_task
    except asyncio.CancelledError:
        pass
    try:
        await redis_task
    except asyncio.CancelledError:
        pass

    logger.info("WebSocket server stopped.")


def main():
    asyncio.run(run_server())


if __name__ == "__main__":
    main()
