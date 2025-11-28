import json
import uuid
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from agents.orchestrator import orchestrator

app = FastAPI()

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """Handles incoming WebSocket connections and messages."""
    await websocket.accept()
    session_id = None
    print("New client connected, waiting for session ID...")

    try:
        while True:
            data = await websocket.receive_text()
            try:
                request = json.loads(data)
                
                if not session_id:
                    session_id = request.get("sessionId")
                    if not session_id:
                        await websocket.send_json({"error": "Session ID not provided."})
                        continue
                    print(f"Client registered with session ID: {session_id}")

                await orchestrator.handle_message(session_id, websocket, request)
            except json.JSONDecodeError:
                await websocket.send_json({"error": "Invalid JSON format."})
            except Exception as e:
                error_message = f"An unexpected error occurred: {e}"
                print(error_message)
                await websocket.send_json({"error": error_message})

    except WebSocketDisconnect:
        if session_id:
            print(f"Client {session_id} disconnected")
            if session_id in orchestrator.sessions:
                del orchestrator.sessions[session_id]
    except Exception as e:
        if session_id:
            print(f"An error occurred in session {session_id}: {e}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="0.0.0.0", port=8001, reload=True)