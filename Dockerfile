# =============================================================================
# Gulf Watch - Multi-stage Production Dockerfile
#
# Stage 1: Node.js API + static frontend
# Stage 2: Python ingestion modules
# Stage 3: Final minimal image combining both
#
# Build:  docker build -t gulfwatch:latest .
# Run:    docker-compose up  (see docker-compose.yml)
# =============================================================================

# ---------------------------------------------------------------------------
# Stage 1: Node.js dependencies & API build
# ---------------------------------------------------------------------------
FROM node:20-alpine AS node-build

WORKDIR /app

# Install dependencies first for layer caching
COPY package.json package-lock.json* ./
RUN npm ci --production --ignore-scripts 2>/dev/null || npm install --production --ignore-scripts

# Copy API and static assets
COPY api/ ./api/
COPY public/ ./public/
COPY vercel.json ./

# ---------------------------------------------------------------------------
# Stage 2: Python dependencies & modules
# ---------------------------------------------------------------------------
FROM python:3.11-slim AS python-build

WORKDIR /app

# System dependencies for scientific/NLP packages
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        libffi-dev \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt* ./
RUN if [ -f requirements.txt ]; then \
        pip install --no-cache-dir --target=/app/site-packages -r requirements.txt; \
    else \
        pip install --no-cache-dir --target=/app/site-packages \
            requests>=2.31 \
            feedparser>=6.0 \
            beautifulsoup4>=4.12 \
            lxml>=5.0 \
            python-dateutil>=2.8; \
    fi

# Copy Python modules
COPY *_module.py ./modules/
COPY scripts/ ./scripts/

# ---------------------------------------------------------------------------
# Stage 3: Final production image
# ---------------------------------------------------------------------------
FROM node:20-alpine AS production

# Security: run as non-root
RUN addgroup -g 1001 -S gulfwatch && \
    adduser -u 1001 -S gulfwatch -G gulfwatch

# Install Python runtime (no build tools)
RUN apk add --no-cache python3 py3-pip

WORKDIR /app

# Copy Node.js artifacts
COPY --from=node-build /app/node_modules ./node_modules
COPY --from=node-build /app/api ./api
COPY --from=node-build /app/public ./public
COPY --from=node-build /app/vercel.json ./
COPY --from=node-build /app/package.json ./

# Copy Python artifacts
COPY --from=python-build /app/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=python-build /app/modules ./modules
COPY --from=python-build /app/scripts ./scripts

# Copy remaining config files
COPY incidents.json* ./
COPY test_integration.py* ./

# Create output directories
RUN mkdir -p /app/data /app/logs /app/output && \
    chown -R gulfwatch:gulfwatch /app

# Read-only root filesystem compatibility: writable dirs
VOLUME ["/app/data", "/app/logs", "/app/output"]

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://localhost:${PORT:-3000}/api/health || exit 1

# Runtime configuration
ENV NODE_ENV=production \
    PORT=3000 \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

EXPOSE 3000

USER gulfwatch

# Default entrypoint: serve the API
# Override in docker-compose for ingestion workers
CMD ["node", "api/server.js"]
