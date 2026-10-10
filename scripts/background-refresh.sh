#!/usr/bin/env bash
# Headless background updater for Gulf Watch.
# Pulls new JSON from GitHub every 5 minutes; runs a full RSS fetch every 6 hours.

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/gulfwatch"
PID_FILE="$DATA_DIR/refresh.pid"
LOG_FILE="$DATA_DIR/refresh.log"
VENV_PYTHON="$REPO_ROOT/.venv/bin/python"

PULL_INTERVAL=300      # 5 minutes
FETCH_INTERVAL=21600   # 6 hours

mkdir -p "$DATA_DIR"

log() {
    printf '[%s] %s\n' "$(date -Iseconds)" "$*" >> "$LOG_FILE"
}

git_pull() {
    cd "$REPO_ROOT" || return 1
    if git fetch origin >> "$LOG_FILE" 2>&1 && git pull --rebase origin main >> "$LOG_FILE" 2>&1; then
        log "Git pull succeeded"
        return 0
    fi
    log "Git pull failed"
    return 1
}

full_fetch() {
    if [[ ! -x "$VENV_PYTHON" ]]; then
        log "Skipping full fetch (.venv not found)"
        return 1
    fi

    log "Starting full RSS fetch"
    cd "$REPO_ROOT" || return 1

    if "$VENV_PYTHON" scripts/fetch_rss.py >> "$LOG_FILE" 2>&1 \
        && "$VENV_PYTHON" scripts/fetch_prices.py >> "$LOG_FILE" 2>&1 \
        && "$VENV_PYTHON" scripts/generate_regional_stats.py public/incidents.json public/data/regional_stats.json >> "$LOG_FILE" 2>&1 \
        && "$VENV_PYTHON" scripts/cross_source_verification.py >> "$LOG_FILE" 2>&1; then
        log "Full fetch completed"
        return 0
    fi

    log "Full fetch failed"
    return 1
}

stop_existing() {
    if [[ -f "$PID_FILE" ]]; then
        local old_pid
        old_pid="$(cat "$PID_FILE")"
        if [[ -n "$old_pid" ]] && kill -0 "$old_pid" 2>/dev/null; then
            kill "$old_pid" 2>/dev/null || true
            log "Stopped previous refresh loop (pid $old_pid)"
        fi
        rm -f "$PID_FILE"
    fi
}

run_loop() {
    log "Background refresh loop started (pull every ${PULL_INTERVAL}s, fetch every ${FETCH_INTERVAL}s)"
    local last_fetch=0

    while true; do
        git_pull

        local now
        now="$(date +%s)"
        if (( now - last_fetch >= FETCH_INTERVAL )); then
            full_fetch && last_fetch="$now"
        fi

        sleep "$PULL_INTERVAL"
    done
}

case "${1:-start}" in
    start)
        if [[ -f "$PID_FILE" ]]; then
            existing_pid="$(cat "$PID_FILE")"
            if [[ -n "$existing_pid" ]] && kill -0 "$existing_pid" 2>/dev/null; then
                log "Refresh loop already running (pid $existing_pid)"
                exit 0
            fi
        fi

        stop_existing
        run_loop &
        echo $! > "$PID_FILE"
        log "Refresh loop launched (pid $!)"
        ;;
    stop)
        stop_existing
        ;;
    status)
        if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
            echo "running (pid $(cat "$PID_FILE"))"
        else
            echo "stopped"
        fi
        ;;
    *)
        echo "Usage: $0 {start|stop|status}"
        exit 1
        ;;
esac