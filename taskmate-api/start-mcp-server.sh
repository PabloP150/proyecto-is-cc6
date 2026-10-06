#!/bin/bash
cd "$(dirname "$0")/mcp"
source venv/bin/activate
uvicorn server:app --host 127.0.0.1 --port 8001 --ws-max-size 4194304 --reload
