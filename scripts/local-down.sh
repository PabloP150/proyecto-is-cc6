#!/usr/bin/env bash
# Stop what scripts/local-up.sh started.
#
#     ./scripts/local-down.sh          stop TaskMate's processes and SQL Server
#     ./scripts/local-down.sh --all    also stop the local AI (AI server, its database, Ollama)
#
# Never deletes data: the SQL Server container is stopped, not removed.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AI_SERVER_DIR="${AI_SERVER_DIR:-$(cd "$ROOT/.." && pwd)/ai-server}"
RUN_DIR="$ROOT/.local/run"
ALL=0

case "${1:-}" in
    --all) ALL=1 ;;
    "") ;;
    *) echo "Usage: $0 [--all]" >&2; exit 2 ;;
esac

stop() {
    local name="$1" pidfile="$RUN_DIR/$1.pid" pid
    pid="$(cat "$pidfile" 2>/dev/null || true)"
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
        kill -- "-$pid" 2>/dev/null || kill "$pid" 2>/dev/null
        for _ in $(seq 1 10); do kill -0 "$pid" 2>/dev/null || break; sleep 0.5; done
        printf '   %-8s stopped\n' "$name"
    else
        printf '   %-8s not running\n' "$name"
    fi
    rm -f "$pidfile"
    return 0
}

echo ">> TaskMate"
stop web
stop api
stop mcp

if podman container exists taskmate-sql 2>/dev/null; then
    podman stop taskmate-sql >/dev/null 2>&1 && printf '   %-8s stopped\n' sql || printf '   %-8s not running\n' sql
fi

if [[ "$ALL" -eq 1 ]]; then
    echo ">> Local AI"
    if [[ -x "$AI_SERVER_DIR/scripts/down.sh" ]]; then
        "$AI_SERVER_DIR/scripts/down.sh" | sed 's/^/   /'
    else
        systemctl --user stop ollama && echo "   ollama   stopped"
    fi
fi
echo
echo "Stopped. Start again with ./scripts/local-up.sh"
