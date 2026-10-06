#!/bin/bash
# Starts SQL Server (Docker), the AI server and the API. The frontend runs separately (npm start).
# Ports come from .env (API_PORT, MCP_PORT; defaults 9000 and 8001). Only TaskMate's own processes are
# restarted: a port held by anything else (another project, Docker's port proxy…) stops the script
# instead of being killed.

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
DOCKER="$(command -v docker || echo /Applications/Docker.app/Contents/Resources/bin/docker)"
ENV_FILE="$PROJECT_DIR/.env"

env_value() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d "\"'"; }
API_PORT="${API_PORT:-$(env_value API_PORT)}"; API_PORT="${API_PORT:-9000}"
MCP_PORT="${MCP_PORT:-$(env_value MCP_PORT)}"; MCP_PORT="${MCP_PORT:-8001}"
LLM_WEBSOCKET_URL="${LLM_WEBSOCKET_URL:-$(env_value LLM_WEBSOCKET_URL)}"

port_owner() { lsof -nP -iTCP:"$1" -sTCP:LISTEN 2>/dev/null | awk 'NR>1 {print $1" (pid "$2")"; exit}'; }

echo "==> Iniciando TaskMate..."

# 1. Docker
echo "[1/4] Verificando Docker..."
if ! "$DOCKER" info > /dev/null 2>&1; then
  echo "     Docker no está corriendo. Abriendo Docker Desktop..."
  open -a Docker
  for _ in $(seq 1 45); do "$DOCKER" info > /dev/null 2>&1 && break; sleep 2; done
  "$DOCKER" info > /dev/null 2>&1 || { echo "     ERROR: Docker no respondió en 90 s."; exit 1; }
fi

# 2. SQL Server
echo "[2/4] Iniciando SQL Server..."
"$DOCKER" start taskmate-sql > /dev/null 2>&1 || { echo "     ERROR: no se pudo iniciar el contenedor taskmate-sql."; exit 1; }
for _ in $(seq 1 30); do nc -z localhost 1433 2> /dev/null && break; sleep 2; done

# 3. Stop only our own previous processes, then make sure the ports are free.
pkill -f "node .*taskmate-api/server.js" 2> /dev/null
pkill -f "uvicorn server:app" 2> /dev/null
sleep 1
for port in "$API_PORT" "$MCP_PORT"; do
  owner="$(port_owner "$port")"
  if [ -n "$owner" ]; then
    echo "     ERROR: el puerto $port está ocupado por $owner, que no es de TaskMate."
    echo "     Libéralo o cambia API_PORT / MCP_PORT (y LLM_WEBSOCKET_URL) en .env."
    exit 1
  fi
done
case "$LLM_WEBSOCKET_URL" in
  ""|*":$MCP_PORT/"*) ;;
  *) echo "     AVISO: LLM_WEBSOCKET_URL ($LLM_WEBSOCKET_URL) no usa el puerto MCP_PORT=$MCP_PORT." ;;
esac

# 4. AI server first, so the API connects to it right away.
echo "[3/4] Iniciando servidor de IA (127.0.0.1:$MCP_PORT)..."
if ! grep -q '^MCP_SHARED_SECRET=.' "$ENV_FILE" 2> /dev/null && [ -z "$MCP_SHARED_SECRET" ]; then
  echo "     AVISO: falta MCP_SHARED_SECRET en .env; el servidor de IA no arrancará."
fi
cd "$PROJECT_DIR/taskmate-api/mcp" || exit 1
venv/bin/python -m uvicorn server:app --host 127.0.0.1 --port "$MCP_PORT" --ws-max-size 4194304 > /tmp/taskmate-mcp.log 2>&1 &
sleep 3

echo "[4/4] Iniciando API (puerto $API_PORT)..."
cd "$PROJECT_DIR" || exit 1
node taskmate-api/server.js > /tmp/taskmate-backend.log 2>&1 &
sleep 3

echo ""
echo "✓ Todo listo:"
echo "  Frontend:  http://localhost:3000  (corre: npm start)"
echo "  API:       http://localhost:$API_PORT"
echo "  IA:        ws://127.0.0.1:$MCP_PORT/ws (solo local, requiere X-MCP-Secret)"
echo ""
echo "Logs:"
echo "  API: tail -f /tmp/taskmate-backend.log"
echo "  IA:  tail -f /tmp/taskmate-mcp.log"
