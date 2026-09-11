import asyncio
import json
import re

import anyio
import pytest
from starlette.testclient import TestClient

import llm_service
import server
from agents.orchestrator import OrchestratorAgent


def recv(ws, timeout=5.0):
    """receive_json with a timeout so a regression fails instead of hanging the suite."""
    async def _receive():
        with anyio.fail_after(timeout):
            return await ws._send_rx.receive()

    message = ws.portal.call(_receive)
    assert message["type"] == "websocket.send", message
    return json.loads(message["text"])


def user_msg(session_id, request_id, text):
    return {"requestId": request_id, "sessionId": session_id, "method": "handle_user_message",
            "params": {"message": text, "context": {"userId": "u1"}}}


async def fake_generate(prompt, generation_config_override=None, max_tokens=None, timeout=None):
    if "Respond with ONLY: YES or NO" in prompt:
        return "NO"
    message = re.search(r'USER\'S CURRENT MESSAGE: "(.*)"', prompt).group(1)
    if "SLOW" in message:
        await asyncio.sleep(0.4)
    return f"echo:{message}"


@pytest.fixture
def agent(monkeypatch):
    fresh = OrchestratorAgent()
    monkeypatch.setattr(server, "orchestrator", fresh)
    monkeypatch.setattr(llm_service, "generate", fake_generate)
    return fresh


@pytest.fixture
def ws(agent):
    with TestClient(server.app).websocket_connect("/ws") as socket:
        yield socket


def test_two_sessions_do_not_share_state(agent, ws):
    ws.send_json(user_msg("A", "r1", "I want to build an app for dogs"))
    ws.send_json(user_msg("B", "r2", "hello from B"))
    replies = {reply["sessionId"]: reply for reply in (recv(ws), recv(ws))}

    assert replies["A"]["requestId"] == "r1"
    assert replies["A"]["data"]["content"] == "echo:I want to build an app for dogs"
    assert replies["B"]["requestId"] == "r2"
    assert replies["B"]["data"]["content"] == "echo:hello from B"
    history_a = agent.sessions["A"]["conversation_history"]
    history_b = agent.sessions["B"]["conversation_history"]
    assert all("B" not in line for line in history_a)
    assert all("dogs" not in line for line in history_b)
    assert "dogs" in agent.sessions["A"]["project_info"]
    assert agent.sessions["B"]["project_info"] == ""


def test_slow_session_does_not_block_other_session(ws):
    ws.send_json(user_msg("A", "slow", "SLOW question"))
    ws.send_json(user_msg("B", "fast", "quick question"))
    first, second = recv(ws), recv(ws)
    assert (first["sessionId"], first["requestId"]) == ("B", "fast")
    assert (second["sessionId"], second["requestId"]) == ("A", "slow")


def test_order_is_preserved_within_a_session(ws):
    ws.send_json(user_msg("A", "1", "SLOW one"))
    ws.send_json(user_msg("A", "2", "two"))
    ws.send_json(user_msg("A", "3", "three"))
    assert [recv(ws)["requestId"] for _ in range(3)] == ["1", "2", "3"]


def test_stateless_requests_do_not_wait_for_the_session_lock(ws):
    ws.send_json(user_msg("A", "chat", "SLOW question"))
    ws.send_json({"requestId": "an", "sessionId": "A", "type": "analytics",
                  "action": "get_team_analytics", "data": {"group_id": "unknown-group"}})
    first = recv(ws)
    assert (first["event"], first["requestId"]) == ("analytics_response", "an")
    assert recv(ws)["requestId"] == "chat"


def test_every_error_reply_carries_session_and_request_ids(agent, ws, monkeypatch):
    ws.send_text('{"sessionId": "S1", "requestId": "bad-json", "params": ')
    reply = recv(ws)
    assert reply == {"event": "error", "sessionId": "S1", "requestId": "bad-json", "error": "Invalid JSON format."}

    ws.send_text("not json at all")
    reply = recv(ws)
    assert "sessionId" in reply and "requestId" in reply and reply["event"] == "error"

    ws.send_json({"requestId": "no-session", "params": {"message": "hi"}})
    assert recv(ws) == {"event": "error", "sessionId": None, "requestId": "no-session",
                        "error": "Session ID not provided."}

    ws.send_json({"requestId": "r-unknown", "sessionId": "S1", "method": "does_not_exist"})
    reply = recv(ws)
    assert (reply["event"], reply["sessionId"], reply["requestId"]) == ("error", "S1", "r-unknown")

    ws.send_json(user_msg("S1", "r-empty", "   "))
    reply = recv(ws)
    assert (reply["event"], reply["sessionId"], reply["requestId"]) == ("error", "S1", "r-empty")

    async def boom(*_args, **_kwargs):
        raise RuntimeError("secret internal detail")

    monkeypatch.setattr(agent, "_handle_user_message", boom)
    ws.send_json(user_msg("S1", "r-crash", "hello"))
    reply = recv(ws)
    assert (reply["event"], reply["sessionId"], reply["requestId"]) == ("error", "S1", "r-crash")
    assert "secret internal detail" not in reply["error"]

    monkeypatch.setattr(agent.analytics_agent, "handle", boom)
    ws.send_json({"requestId": "r-an", "sessionId": "S2", "type": "analytics", "action": "x", "data": {}})
    reply = recv(ws)
    assert (reply["event"], reply["sessionId"], reply["requestId"]) == ("analytics_error", "S2", "r-an")

    monkeypatch.setattr(agent.repo_analysis_agent, "analyze", boom)
    ws.send_json({"requestId": "r-repo", "sessionId": "S3", "method": "analyze_repository", "params": {}})
    reply = recv(ws)
    assert (reply["event"], reply["sessionId"], reply["requestId"]) == ("repo_analysis_error", "S3", "r-repo")
    assert reply["error"]["code"] == "INTERNAL_ERROR"


def test_llm_failure_becomes_a_friendly_reply(agent, ws, monkeypatch):
    async def rate_limited(*_args, **_kwargs):
        raise llm_service.LLMRateLimitError("limit", retry_after=12.2)

    monkeypatch.setattr(llm_service, "generate", rate_limited)
    ws.send_json(user_msg("A", "r1", "I want to build a website"))
    reply = recv(ws)
    assert reply["event"] == "response"
    assert (reply["sessionId"], reply["requestId"]) == ("A", "r1")
    assert "try again in 12s" in reply["data"]["content"]
    assert reply["data"]["error"] == {"code": "LLM_RATE_LIMIT", "retryAfterSec": 12}
    # The failed turn is not kept, so a retry does not duplicate it in the LLM context.
    assert agent.sessions["A"]["conversation_history"] == []


def test_session_state_survives_disconnect_and_expires_by_ttl(agent):
    client = TestClient(server.app)
    with client.websocket_connect("/ws") as socket:
        socket.send_json(user_msg("A", "r1", "first message"))
        recv(socket)
    assert "A" in agent.sessions

    with client.websocket_connect("/ws") as socket:
        socket.send_json(user_msg("A", "r2", "second message"))
        recv(socket)
    history = agent.sessions["A"]["conversation_history"]
    assert history[0] == "User: first message" and "User: second message" in history

    last_seen = agent.sessions["A"]["last_seen"]
    assert agent.purge_expired_sessions(now=last_seen + agent.session_ttl_sec - 1) == 0
    assert agent.purge_expired_sessions(now=last_seen + agent.session_ttl_sec + 1) == 1
    assert "A" not in agent.sessions


async def test_connection_close_cancels_in_flight_tasks():
    started = asyncio.Event()
    cancelled = asyncio.Event()

    class SlowAgent:
        requires_session_lock = staticmethod(lambda request: True)
        error_reply = staticmethod(OrchestratorAgent.error_reply)

        async def handle_message(self, session_id, websocket, request):
            started.set()
            try:
                await asyncio.sleep(30)
            except asyncio.CancelledError:
                cancelled.set()
                raise

    class DeadSocket:
        async def send_json(self, message):
            raise RuntimeError("closed")

    connection = server.Connection(DeadSocket(), SlowAgent())
    connection.dispatch(json.dumps(user_msg("A", "r1", "hi")))
    await asyncio.wait_for(started.wait(), 1)
    await asyncio.wait_for(connection.close(), 1)
    assert cancelled.is_set()
    assert not connection._tasks and not connection._session_locks
