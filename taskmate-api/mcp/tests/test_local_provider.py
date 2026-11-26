"""The Ollama provider in llm_service, against a mocked HTTP transport (no model needed)."""
import json

import httpx
import pytest

import llm_service


@pytest.fixture
def ollama(monkeypatch):
    """Route llm_service's httpx calls to a handler the test controls."""
    monkeypatch.setattr(llm_service, "PROVIDER", "ollama")
    seen = {"requests": []}
    handlers = {}

    def transport(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        seen["requests"].append(body)
        return handlers["handle"](body)

    real_client = httpx.AsyncClient

    def fake_client(*args, **kwargs):
        kwargs["transport"] = httpx.MockTransport(transport)
        return real_client(*args, **kwargs)

    monkeypatch.setattr(llm_service.httpx, "AsyncClient", fake_client)
    monkeypatch.setattr(llm_service, "_ollama_http", None)

    def respond(fn):
        handlers["handle"] = fn

    seen["respond"] = respond
    return seen


def _reply(content):
    return httpx.Response(200, json={"message": {"role": "assistant", "content": content}, "done": True})


async def test_generate_returns_the_local_model_text(ollama):
    ollama["respond"](lambda body: _reply("  Hola mundo  "))
    assert await llm_service.generate("hi", max_tokens=50) == "Hola mundo"


async def test_requests_disable_thinking_and_size_the_context(ollama):
    # Gemma 4 thinks by default on /api/chat; measured, that spent a whole 200-token budget
    # reasoning and answered "Un". The flag must go out on every request.
    ollama["respond"](lambda body: _reply("ok"))
    await llm_service.generate("hi", max_tokens=77)
    sent = ollama["requests"][0]
    assert sent["think"] is False
    assert sent["options"]["num_predict"] == 77
    assert sent["options"]["num_ctx"] == llm_service.OLLAMA_NUM_CTX
    assert sent["model"] == llm_service.OLLAMA_MODEL


async def test_generate_json_uses_json_format(ollama):
    ollama["respond"](lambda body: _reply('{"tasks": ["a", "b"]}'))
    assert await llm_service.generate_json("Return json") == {"tasks": ["a", "b"]}
    assert ollama["requests"][0]["format"] == "json"


async def test_repeat_penalty_goes_out_only_when_asked(ollama):
    ollama["respond"](lambda body: _reply('{"ok": true}'))
    await llm_service.generate_json("Return json")
    await llm_service.generate_json("Return json", local_repeat_penalty=1.1)
    await llm_service.generate("hi")
    first, second, chat = ollama["requests"]
    assert "repeat_penalty" not in first["options"] and "repeat_penalty" not in chat["options"]
    assert second["options"]["repeat_penalty"] == 1.1


async def test_the_new_project_plan_asks_for_the_repeat_penalty(ollama):
    # Without it Gemma 4 looped on this long JSON about half the time ("token repeat limit reached").
    from agents.recommendations_agent import RecommendationsAgent, PLAN_REPEAT_PENALTY
    ollama["respond"](lambda body: _reply('{"recommendations": {"tasks": []}}'))
    await RecommendationsAgent().handle("an e-commerce app")
    assert ollama["requests"][0]["options"]["repeat_penalty"] == PLAN_REPEAT_PENALTY == 1.1


async def test_generate_json_rejects_non_objects(ollama):
    ollama["respond"](lambda body: _reply("not json at all"))
    with pytest.raises(llm_service.LLMInvalidOutputError):
        await llm_service.generate_json("Return json")


async def test_streaming_yields_deltas_and_returns_the_whole_text(ollama):
    lines = "\n".join(json.dumps(e) for e in [
        {"message": {"content": "Hola"}, "done": False},
        {"message": {"content": ", "}, "done": False},
        {"message": {"thinking": "should never surface"}, "done": False},
        {"message": {"content": "mundo"}, "done": False},
        {"message": {"content": ""}, "done": True},
    ])
    ollama["respond"](lambda body: httpx.Response(200, text=lines))

    received = []

    async def on_delta(piece):
        received.append(piece)

    full = await llm_service.generate("hi", on_delta=on_delta)
    assert received == ["Hola", ", ", "mundo"]
    assert full == "Hola, mundo"
    assert ollama["requests"][0]["stream"] is True


async def test_a_missing_model_says_how_to_install_it(ollama):
    ollama["respond"](lambda body: httpx.Response(404, json={"error": "model not found"}))
    with pytest.raises(llm_service.LLMError, match="ollama pull"):
        await llm_service.generate("hi")


async def test_ollama_down_is_a_typed_error_not_a_crash(monkeypatch):
    monkeypatch.setattr(llm_service, "PROVIDER", "ollama")
    monkeypatch.setattr(llm_service, "OLLAMA_HOST", "http://127.0.0.1:9")  # nothing listens here
    with pytest.raises(llm_service.LLMError, match="local model"):
        await llm_service.generate("hi", timeout=2)


async def test_an_error_mid_stream_raises(ollama):
    lines = "\n".join(json.dumps(e) for e in [
        {"message": {"content": "Hola"}, "done": False},
        {"error": "out of memory"},
    ])
    ollama["respond"](lambda body: httpx.Response(200, text=lines))

    async def on_delta(_piece):
        pass

    with pytest.raises(llm_service.LLMError):
        await llm_service.generate("hi", on_delta=on_delta)


async def test_requests_keep_the_model_loaded(ollama):
    ollama["respond"](lambda body: _reply("ok"))
    await llm_service.generate("hi", max_tokens=5)
    await llm_service.generate("again", max_tokens=5)
    assert all(r["keep_alive"] == llm_service.OLLAMA_KEEP_ALIVE for r in ollama["requests"])
