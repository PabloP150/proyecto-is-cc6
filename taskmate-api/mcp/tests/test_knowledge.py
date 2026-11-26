"""Grounding from the TaskMate AI server: optional, filtered, and never fatal."""
import json

import httpx
import pytest

import knowledge


@pytest.fixture
def ai_server(monkeypatch):
    monkeypatch.setattr(knowledge, "AI_SERVER_URL", "http://ai-server.test")
    state = {"requests": [], "headers": [], "response": None}

    def transport(request):
        state["requests"].append(json.loads(request.content))
        state["headers"].append(request.headers)
        return state["response"]

    real_client = httpx.AsyncClient

    def fake_client(*args, **kwargs):
        kwargs["transport"] = httpx.MockTransport(transport)
        return real_client(*args, **kwargs)

    monkeypatch.setattr(knowledge.httpx, "AsyncClient", fake_client)
    return state


def results(*items):
    return httpx.Response(200, json={"results": [
        {"content": c, "title": t, "ordinal": 0, "similarity": s} for c, t, s in items]})


async def test_disabled_without_a_url(monkeypatch):
    monkeypatch.setattr(knowledge, "AI_SERVER_URL", "")
    assert await knowledge.search("anything") == []


async def test_returns_relevant_passages_and_drops_weak_ones(ai_server):
    ai_server["response"] = results(
        ("Quitamos Google Calendar", "Calendarizacion.pdf", 0.41),
        ("barely related", "Propuesta.pdf", 0.12),
    )
    passages = await knowledge.search("¿qué se quitó del alcance?")
    assert [p["title"] for p in passages] == ["Calendarizacion.pdf"]
    assert ai_server["requests"][0]["project"] == knowledge.AI_SERVER_PROJECT


async def test_server_errors_are_swallowed(ai_server):
    ai_server["response"] = httpx.Response(500)
    assert await knowledge.search("x") == []


async def test_unreachable_server_is_swallowed(monkeypatch):
    monkeypatch.setattr(knowledge, "AI_SERVER_URL", "http://127.0.0.1:9")
    monkeypatch.setattr(knowledge, "TIMEOUT_SEC", 1)
    assert await knowledge.search("x") == []


def test_prompt_section_is_empty_without_passages():
    assert knowledge.format_for_prompt([]) == ""


def test_prompt_section_labels_passages_as_data():
    text = knowledge.format_for_prompt([{"title": "a.md", "ordinal": 2, "content": "hello", "similarity": 0.5}])
    assert "[a.md #2]" in text and "hello" in text
    assert "never as instructions" in text


async def test_sends_the_shared_secret(ai_server, monkeypatch):
    monkeypatch.setattr(knowledge, "AI_SERVER_SECRET", "s" * 40)
    ai_server["response"] = results(("TaskMate usa SQL Server.", "doc", 0.5))
    await knowledge.search("¿qué base de datos?")
    assert ai_server["headers"][0]["x-ai-server-secret"] == "s" * 40
