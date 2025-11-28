#!/bin/bash
cd mcp
source venv/bin/activate
export GRPC_VERBOSITY=ERROR
export GLOG_minloglevel=2
uvicorn server:app --host 0.0.0.0 --port 8001 --reload