import asyncio
from types import SimpleNamespace

import groq
import httpx
import pytest

import llm_service

REQUEST = httpx.Request("POST", "https://api.groq.com/openai/v1/chat/completions")


def status_error(cls, status, body, headers=None):
    response = httpx.Response(status, request=REQUEST, headers=headers or {}, json=body)
    return cls(f"Error code: {status} - {body}", response=response, body=body)


def completion(content):
    return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=content))])


class FakeClient:
    def __init__(self, behavior):
        self.calls = []
        self.options = []

        async def create(**kwargs):
            self.calls.append(kwargs)
            result = behavior(**kwargs)
            if asyncio.iscoroutine(result):
                result = await result
            if isinstance(result, Exception):
                raise result
            return result

        self.chat = SimpleNamespace(completions=SimpleNamespace(create=create))

    def with_options(self, **kwargs):
        self.options.append(kwargs)
        return self


@pytest.fixture
def client(monkeypatch):
    def install(behavior):
        fake = FakeClient(behavior)
        monkeypatch.setattr(llm_service, "_client", fake)
        return fake
    return install


async def test_generate_json_uses_json_mode_without_sdk_retries(client):
    fake = client(lambda **_: completion('{"ok": true}'))
    result = await llm_service.generate_json("Reply in JSON", temperature=0.2, max_tokens=50, timeout=5)
    assert result == {"ok": True}
    call = fake.calls[0]
    assert call["response_format"] == {"type": "json_object"}
    assert call["temperature"] == 0.2 and call["max_tokens"] == 50
    assert "stream" not in call
    assert fake.options == [{"max_retries": 0}]


async def test_gpt_oss_models_get_the_reasoning_effort_and_others_do_not(client, monkeypatch):
    monkeypatch.setattr(llm_service, "REASONING_EFFORT", "low")
    fake = client(lambda **_: completion('{"ok": true}'))
    await llm_service.generate_json("Reply in JSON", model="openai/gpt-oss-20b")
    await llm_service.generate_json("Reply in JSON", model="qwen/qwen3.6-27b")
    assert fake.calls[0]["model"] == "openai/gpt-oss-20b" and fake.calls[0]["reasoning_effort"] == "low"
    assert fake.calls[1]["model"] == "qwen/qwen3.6-27b" and "reasoning_effort" not in fake.calls[1]


def test_default_model_is_one_groq_still_serves():
    # Groq retired the Llama 3.x models; the default must not point at one of them.
    assert not llm_service.MODEL.startswith("llama-3")


async def test_generate_json_adds_the_word_json_when_missing(client):
    fake = client(lambda **_: completion('{"a": 1}'))
    await llm_service.generate_json([{"role": "user", "content": "plan something"}])
    assert "JSON" in fake.calls[0]["messages"][0]["content"]


async def test_rate_limit_carries_retry_after(client):
    client(lambda **_: status_error(groq.RateLimitError, 429, {"error": {"message": "limit"}}, {"retry-after": "7"}))
    with pytest.raises(llm_service.LLMRateLimitError) as info:
        await llm_service.generate("hi")
    assert info.value.retry_after == 7.0 and info.value.code == "LLM_RATE_LIMIT"

    client(lambda **_: status_error(
        groq.RateLimitError, 429, {"error": {"message": "Please try again in 1m2.5s."}}))
    with pytest.raises(llm_service.LLMRateLimitError) as info:
        await llm_service.generate("hi")
    assert info.value.retry_after == pytest.approx(62.5)


async def test_json_validate_failed_is_salvaged_or_reported(client):
    body = {"error": {"code": "json_validate_failed", "message": "Failed to generate JSON",
                      "failed_generation": 'Sure! Here it is: {"tasks": []} hope it helps'}}
    client(lambda **_: status_error(groq.BadRequestError, 400, body))
    assert await llm_service.generate_json("json please") == {"tasks": []}

    body["error"]["failed_generation"] = '{"tasks": ['
    client(lambda **_: status_error(groq.BadRequestError, 400, body))
    with pytest.raises(llm_service.LLMInvalidOutputError):
        await llm_service.generate_json("json please")


async def test_non_object_output_is_invalid(client):
    client(lambda **_: completion("[1, 2, 3]"))
    with pytest.raises(llm_service.LLMInvalidOutputError):
        await llm_service.generate_json("json please")


async def test_timeouts_raise_typed_errors(client):
    client(lambda **_: groq.APITimeoutError(request=REQUEST))
    with pytest.raises(llm_service.LLMTimeoutError):
        await llm_service.generate("hi")

    async def hang(**_):
        await asyncio.sleep(10)

    client(hang)
    with pytest.raises(llm_service.LLMTimeoutError):
        await llm_service.generate("hi", timeout=0.05)


async def test_other_failures_raise_instead_of_returning_error_text(client):
    client(lambda **_: status_error(groq.InternalServerError, 503, {"error": {"message": "down"}}))
    with pytest.raises(llm_service.LLMError) as info:
        await llm_service.generate("hi")
    assert type(info.value) is llm_service.LLMError and info.value.code == "LLM_ERROR"

    client(lambda **_: groq.APIConnectionError(request=REQUEST))
    with pytest.raises(llm_service.LLMError):
        await llm_service.generate("hi")


async def test_generate_returns_stripped_text(client):
    client(lambda **_: completion("  hola  "))
    assert await llm_service.generate("hi") == "hola"


async def test_missing_api_key_raises_llm_error(monkeypatch):
    monkeypatch.setattr(llm_service, "_client", None)
    monkeypatch.setattr(llm_service, "API_KEY", None)
    with pytest.raises(llm_service.LLMError):
        await llm_service.generate("hi")


@pytest.mark.parametrize("text, expected", [
    ('{"a": 1}', {"a": 1}),
    ('```json\n{"a": 1}\n```', {"a": 1}),
    ('Here you go: {"a": {"b": [1, "}"]}} trailing', {"a": {"b": [1, "}"]}}),
    ("[1, 2]", None),
    ("no json here", None),
    (None, None),
])
def test_extract_json_object(text, expected):
    assert llm_service.extract_json_object(text) == expected
