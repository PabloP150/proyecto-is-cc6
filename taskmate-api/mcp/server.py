import asyncio
import json
import logging
import os
import re
from contextlib import asynccontextmanager
from typing import Any, Dict, Optional, Set

from fastapi import FastAPI, WebSocket, WebSocketDisconnect

from agents.orchestrator import orchestrator

logging.basicConfig(level=os.getenv('MCP_LOG_LEVEL', 'INFO'),
                    format='%(asctime)s %(levelname)s %(name)s: %(message)s')
logger = logging.getLogger(__name__)

_connections: Set['Connection'] = set()


class _SessionLock:
    __slots__ = ('lock', 'users')

    def __init__(self):
        self.lock = asyncio.Lock()
        self.users = 0


def _ids_from_malformed(raw: str):
    """Best effort so even a reply to malformed JSON can be routed by Node."""
    ids = []
    for key in ('sessionId', 'requestId'):
        match = re.search(r'"%s"\s*:\s*"([^"\\]{1,200})"' % key, raw or '')
        ids.append(match.group(1) if match else None)
    return ids[0], ids[1]


def _error_reply(session_id: Optional[str], request_id: Any, message: str) -> Dict[str, Any]:
    return {"event": "error", "sessionId": session_id, "requestId": request_id, "error": message}


class Connection:
    """One Node <-> Python WebSocket. Node multiplexes every user session over it.

    Each message runs in its own task. Messages of the same session that touch conversation
    state are serialized with a per-session lock; different sessions run concurrently.
    """

    def __init__(self, websocket: WebSocket, agent):
        self.websocket = websocket
        self.agent = agent
        self._send_lock = asyncio.Lock()
        self._session_locks: Dict[str, _SessionLock] = {}
        self._tasks: Set[asyncio.Task] = set()

    async def send_json(self, message: Dict[str, Any]) -> None:
        async with self._send_lock:
            await self.websocket.send_json(message)

    async def _safe_send(self, message: Dict[str, Any]) -> None:
        try:
            await self.send_json(message)
        except Exception:
            logger.debug("Could not deliver reply for request %s", message.get('requestId'), exc_info=True)

    def dispatch(self, raw: str) -> None:
        try:
            request = json.loads(raw)
        except ValueError:
            request = None
        if not isinstance(request, dict):
            session_id, request_id = _ids_from_malformed(raw)
            self._spawn(self._safe_send(_error_reply(session_id, request_id, "Invalid JSON format.")))
            return

        session_id = request.get('sessionId')
        if not isinstance(session_id, str) or not session_id:
            self._spawn(self._safe_send(_error_reply(None, request.get('requestId'), "Session ID not provided.")))
            return
        self._spawn(self._process(session_id, request))

    def _spawn(self, coro) -> None:
        task = asyncio.ensure_future(coro)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    @asynccontextmanager
    async def _session_lock(self, session_id: str):
        entry = self._session_locks.get(session_id)
        if entry is None:
            entry = self._session_locks[session_id] = _SessionLock()
        entry.users += 1
        try:
            async with entry.lock:
                yield
        finally:
            entry.users -= 1
            if entry.users == 0:
                self._session_locks.pop(session_id, None)

    async def _process(self, session_id: str, request: Dict[str, Any]) -> None:
        try:
            if self.agent.requires_session_lock(request):
                async with self._session_lock(session_id):
                    await self.agent.handle_message(session_id, self, request)
            else:
                await self.agent.handle_message(session_id, self, request)
        except Exception:
            logger.exception("Unhandled error for request %s (session %s)", request.get('requestId'), session_id)
            await self._safe_send(self.agent.error_reply(
                session_id, request, "An unexpected error occurred while processing the request."))

    async def close(self) -> None:
        tasks = [task for task in self._tasks if not task.done()]
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    yield
    for connection in list(_connections):
        await connection.close()


app = FastAPI(lifespan=lifespan)


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """Handles the Node.js WebSocket connection and dispatches each message independently."""
    await websocket.accept()
    connection = Connection(websocket, orchestrator)
    _connections.add(connection)
    logger.info("Client connected")
    try:
        while True:
            message = await websocket.receive()
            if message.get('type') == 'websocket.disconnect':
                break
            raw = message.get('text')
            if raw is None and message.get('bytes') is not None:
                raw = message['bytes'].decode('utf-8', errors='replace')
            if raw is not None:
                connection.dispatch(raw)
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("WebSocket connection error")
    finally:
        _connections.discard(connection)
        # Replies can only travel over this socket, so in-flight work is useless once it closes.
        # Session state is kept (with a TTL) so Node can reconnect and continue the conversation.
        await connection.close()
        logger.info("Client disconnected")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host=os.getenv('MCP_HOST', '127.0.0.1'),
                port=int(os.getenv('MCP_PORT', 8001)), reload=True)
