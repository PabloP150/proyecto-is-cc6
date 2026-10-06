#!/bin/bash

PROJECT_DIR="/Users/pablopineda/Downloads/proyecto-is-cc6"
DOCKER="/Applications/Docker.app/Contents/Resources/bin/docker"

echo "==> Iniciando TaskMate..."

# 1. Docker
echo "[1/4] Verificando Docker..."
if ! $DOCKER info > /dev/null 2>&1; then
  echo "     Docker no está corriendo. Abriendo Docker Desktop..."
  open -a Docker
  echo "     Esperando que Docker inicie (30s)..."
  sleep 30
fi

# 2. SQL Server
echo "[2/4] Iniciando SQL Server..."
$DOCKER start taskmate-sql > /dev/null 2>&1
sleep 5

# 3. Backend Node.js
echo "[3/4] Iniciando Backend (puerto 9000)..."
lsof -ti:3000 | xargs kill -9 2>/dev/null
lsof -ti:8001 | xargs kill -9 2>/dev/null
lsof -ti:9000 | xargs kill -9 2>/dev/null
cd "$PROJECT_DIR"
node taskmate-api/server.js > /tmp/taskmate-backend.log 2>&1 &
sleep 3

# 4. Python MCP
echo "[4/4] Iniciando Python MCP (puerto 8001)..."
pkill -f "uvicorn server:app" 2>/dev/null
cd "$PROJECT_DIR/taskmate-api/mcp"
venv/bin/python -m uvicorn server:app --host 0.0.0.0 --port 8001 > /tmp/taskmate-mcp.log 2>&1 &
sleep 3

echo ""
echo "✓ Todo listo:"
echo "  Frontend:  http://localhost:3000  (corre: npm start)"
echo "  Backend:   http://localhost:9000"
echo "  MCP/AI:    http://localhost:8001"
echo ""
echo "Logs:"
echo "  Backend: tail -f /tmp/taskmate-backend.log"
echo "  MCP:     tail -f /tmp/taskmate-mcp.log"
