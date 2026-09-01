#!/usr/bin/env bash
# Gulf Watch desktop launcher: pull latest code, serve public/ on :8001, open Firefox.

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PUBLIC_DIR="$REPO_ROOT/public"
PORT=8001
URL="http://127.0.0.1:${PORT}"
DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/gulfwatch"
PID_FILE="$DATA_DIR/server.pid"
LOG_FILE="$DATA_DIR/launch.log"

mkdir -p "$DATA_DIR"

log() {
    printf '[%s] %s\n' "$(date -Iseconds)" "$*" >> "$LOG_FILE"
}

serving_gulfwatch() {
    curl -sf --connect-timeout 1 "$URL" 2>/dev/null | grep -q 'Gulf Watch'
}

port_in_use() {
    ss -ltn 2>/dev/null | grep -q ":${PORT} " || \
        lsof -i ":${PORT}" -sTCP:LISTEN >/dev/null 2>&1
}

stop_server_on_port() {
    if [[ -f "$PID_FILE" ]]; then
        local old_pid
        old_pid="$(cat "$PID_FILE")"
        if [[ -n "$old_pid" ]] && kill -0 "$old_pid" 2>/dev/null; then
            kill "$old_pid" 2>/dev/null || true
            sleep 0.5
            log "Stopped previous Gulf Watch server (pid $old_pid)"
        fi
        rm -f "$PID_FILE"
    fi

    if port_in_use; then
        local port_pid
        port_pid="$(ss -ltnp 2>/dev/null | grep ":${PORT} " | sed -n 's/.*pid=\([0-9]*\).*/\1/p' | head -1)"
        if [[ -z "$port_pid" ]] && command -v lsof >/dev/null 2>&1; then
            port_pid="$(lsof -ti ":${PORT}" -sTCP:LISTEN 2>/dev/null | head -1)"
        fi
        if [[ -n "$port_pid" ]]; then
            kill "$port_pid" 2>/dev/null || true
            sleep 0.5
            log "Stopped process on port $PORT (pid $port_pid)"
        fi
    fi
}

start_server() {
    if serving_gulfwatch; then
        log "Gulf Watch already serving from public/ on port $PORT"
        return 0
    fi

    stop_server_on_port

    if [[ ! -f "$PUBLIC_DIR/index.html" ]]; then
        log "Missing $PUBLIC_DIR/index.html"
        return 1
    fi

    log "Starting HTTP server from $PUBLIC_DIR on port $PORT"
    (
        cd "$PUBLIC_DIR" || exit 1
        exec python3 -m http.server "$PORT" --bind 127.0.0.1
    ) >> "$LOG_FILE" 2>&1 &

    local pid=$!
    echo "$pid" > "$PID_FILE"

    for _ in {1..20}; do
        if serving_gulfwatch; then
            log "Server ready (pid $pid, cwd public/)"
            return 0
        fi
        sleep 0.25
    done

    log "Server failed to start from public/ on port $PORT"
    return 1
}

open_browser() {
    if command -v firefox >/dev/null 2>&1; then
        firefox --new-tab "$URL" >/dev/null 2>&1 &
        log "Opened Firefox at $URL"
        return 0
    fi

    if command -v xdg-open >/dev/null 2>&1; then
        xdg-open "$URL" >/dev/null 2>&1 &
        log "Opened default browser at $URL"
        return 0
    fi

    log "No browser found; open $URL manually"
    return 1
}

log "Launch requested"
cd "$REPO_ROOT" || exit 1

if git fetch origin >> "$LOG_FILE" 2>&1; then
    if git pull --rebase origin main >> "$LOG_FILE" 2>&1; then
        log "Updated from origin/main"
    else
        log "Git pull failed; continuing with local copy"
    fi
else
    log "Git fetch failed; continuing with local copy"
fi

start_server || exit 1

REFRESH_SCRIPT="$REPO_ROOT/scripts/background-refresh.sh"
if [[ -x "$REFRESH_SCRIPT" ]]; then
    "$REFRESH_SCRIPT" start >> "$LOG_FILE" 2>&1
    log "Background refresh loop started"
fi

open_browser