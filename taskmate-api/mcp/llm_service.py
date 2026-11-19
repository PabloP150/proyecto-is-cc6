import asyncio
import json
import logging
import os
import re
from typing import Any, AsyncIterator, Awaitable, Callable, Dict, List, Optional, Union

import groq
import httpx
from groq import AsyncGroq
from dotenv import load_dotenv

_HERE = os.path.dirname(os.path.abspath(__file__))
# Like the Node API: local files first, then the repository root; existing variables always win.
for _env_path in (os.path.join(_HERE, '.env'), os.path.join(_HERE, '..', '.env'), os.path.join(_HERE, '..', '..', '.env')):
    if os.path.isfile(_env_path):
        load_dotenv(_env_path)

logger = logging.getLogger(__name__)

# Which backend answers: 'groq' (cloud, the original) or 'ollama' (the local model shared with the
# TaskMate AI server). Groq stays the default so a checkout without Ollama keeps working; the local
# deploy script sets LLM_PROVIDER=ollama.
PROVIDER = os.getenv('LLM_PROVIDER', 'groq').strip().lower()

# Local model. Same Ollama instance and model as the TaskMate AI server (ai-server/.env GEN_MODEL),
# so one model stays resident on the 4 GB GPU instead of two competing for it.
OLLAMA_HOST = os.getenv('OLLAMA_HOST', 'http://127.0.0.1:11434').rstrip('/')
OLLAMA_MODEL = os.getenv('OLLAMA_MODEL', 'gemma4:e2b-it-qat')
# Ollama defaults to a 4K context, which a plan prompt plus its 8K-token answer overflows.
OLLAMA_NUM_CTX = int(os.getenv('OLLAMA_NUM_CTX', 8192))
# Gemma 4 is a thinking model and /api/chat enables reasoning for those by default. Measured on this
# model: with it on, a one-sentence answer spent its whole 200-token budget reasoning and returned
# "Un"; with it off the full answer took 0.4 s. The TaskMate AI server never hit this because it
# uses /api/generate. Off unless explicitly asked for.
OLLAMA_THINK = os.getenv('OLLAMA_THINK', '0') == '1'
# Keep the model loaded between chats (Ollama default 5m -> several seconds to reload).
OLLAMA_KEEP_ALIVE = os.getenv('OLLAMA_KEEP_ALIVE', '30m')

API_KEY = os.getenv('GROQ_API_KEY') or os.getenv('LLM_API_KEY')
# Groq retired the Llama 3.x models (they now answer 404 model_not_found).
MODEL = os.getenv('LLM_MODEL', 'openai/gpt-oss-20b')
REPO_ANALYSIS_MODEL = os.getenv('REPO_ANALYSIS_MODEL') or MODEL
# gpt-oss models reason before answering and that reasoning counts against max_tokens and the per-minute
# token quota; "low" keeps chat answers and JSON plans within budget. Only sent to models that accept it.
REASONING_EFFORT = os.getenv('LLM_REASONING_EFFORT', 'low')
TEMPERATURE = float(os.getenv('LLM_TEMPERATURE', 0.7))
TIMEOUT_SEC = float(os.getenv('LLM_TIMEOUT_SEC', 60))
MAX_RETRIES = int(os.getenv('LLM_MAX_RETRIES', 2))

MAX_TOKENS_CHAT = int(os.getenv('LLM_MAX_TOKENS_CHAT', 1000))
MAX_TOKENS_PLAN = int(os.getenv('LLM_MAX_TOKENS_PLAN', 8192))

if PROVIDER == 'groq' and not API_KEY:
    logger.warning("GROQ_API_KEY or LLM_API_KEY not found in environment; LLM calls will fail.")
elif PROVIDER not in ('groq', 'ollama'):
    logger.warning("Unknown LLM_PROVIDER %r; falling back to groq.", PROVIDER)

_client = None

Messages = Union[str, List[Dict[str, str]]]


class LLMError(Exception):
    """Base error for LLM calls. `code` is the stable identifier sent to Node."""
    code = 'LLM_ERROR'


class LLMRateLimitError(LLMError):
    code = 'LLM_RATE_LIMIT'

    def __init__(self, message: str, retry_after: Optional[float] = None):
        super().__init__(message)
        self.retry_after = retry_after


class LLMTimeoutError(LLMError):
    code = 'LLM_TIMEOUT'


class LLMInvalidOutputError(LLMError):
    code = 'LLM_INVALID_OUTPUT'

    def __init__(self, message: str, raw: Optional[str] = None):
        super().__init__(message)
        # Raw model output, kept only for salvage attempts; never logged.
        self.raw = raw


def _get_client(max_retries: Optional[int] = None):
    global _client
    if _client is None:
        if not API_KEY:
            raise LLMError("LLM API key is not configured (GROQ_API_KEY or LLM_API_KEY).")
        _client = AsyncGroq(api_key=API_KEY, timeout=TIMEOUT_SEC, max_retries=MAX_RETRIES)
    if max_retries is not None:
        return _client.with_options(max_retries=max_retries)
    return _client


def _retry_after_seconds(exc: Exception) -> Optional[float]:
    response = getattr(exc, 'response', None)
    headers = getattr(response, 'headers', None)
    if headers is not None:
        for name, scale in (('retry-after-ms', 1000.0), ('retry-after', 1.0)):
            value = headers.get(name)
            if value is None:
                continue
            try:
                return max(0.0, float(value) / scale)
            except (TypeError, ValueError):
                pass
    match = re.search(r'try again in (?:(\d+)m)?([\d.]+)(ms|s)', str(exc), re.IGNORECASE)
    if match:
        minutes = int(match.group(1) or 0)
        amount = float(match.group(2))
        seconds = amount / 1000.0 if match.group(3).lower() == 'ms' else amount
        return minutes * 60 + seconds
    return None


def _error_body(exc: Exception) -> Dict[str, Any]:
    body = getattr(exc, 'body', None)
    if isinstance(body, dict):
        inner = body.get('error', body)
        if isinstance(inner, dict):
            return inner
    return {}


def _map_error(exc: Exception) -> LLMError:
    if isinstance(exc, LLMError):
        return exc
    if isinstance(exc, (asyncio.TimeoutError, groq.APITimeoutError)):
        return LLMTimeoutError("The LLM request timed out.")
    if isinstance(exc, groq.RateLimitError):
        return LLMRateLimitError("The LLM rate limit was reached.", retry_after=_retry_after_seconds(exc))
    if isinstance(exc, groq.BadRequestError):
        body = _error_body(exc)
        if body.get('code') == 'json_validate_failed':
            raw = body.get('failed_generation')
            return LLMInvalidOutputError("The model did not produce valid JSON.",
                                         raw=raw if isinstance(raw, str) else None)
    if isinstance(exc, groq.APIStatusError):
        return LLMError(f"The LLM provider returned HTTP {exc.status_code}.")
    if isinstance(exc, groq.APIConnectionError):
        return LLMError("Could not reach the LLM provider.")
    return LLMError(f"Unexpected LLM error ({type(exc).__name__}).")


def _log_error(err: LLMError, cause: Exception) -> None:
    # Provider messages can echo model output (repo content), so only log the class of failure.
    if isinstance(err, LLMRateLimitError):
        logger.warning("LLM rate limit (retry after %s s)", err.retry_after)
    elif isinstance(err, (LLMTimeoutError, LLMInvalidOutputError)):
        logger.warning("LLM call failed: %s", err.code)
    else:
        logger.error("LLM call failed: %s (%s)", err, type(cause).__name__)


def _as_messages(messages: Messages) -> List[Dict[str, str]]:
    if isinstance(messages, str):
        return [{"role": "user", "content": messages}]
    return list(messages)


async def _complete(messages: List[Dict[str, str]], *, model: Optional[str], temperature: Optional[float],
                    max_tokens: Optional[int], timeout: Optional[float], max_retries: Optional[int] = None,
                    **extra: Any):
    limit = timeout or TIMEOUT_SEC
    chosen_model = model or MODEL
    if REASONING_EFFORT and chosen_model.startswith('openai/gpt-oss'):
        extra.setdefault('reasoning_effort', REASONING_EFFORT)
    try:
        client = _get_client(max_retries)
        # The SDK timeout is per network operation; wait_for bounds the whole call including retries.
        return await asyncio.wait_for(
            client.chat.completions.create(
                model=chosen_model,
                messages=messages,
                temperature=TEMPERATURE if temperature is None else temperature,
                max_tokens=max_tokens or MAX_TOKENS_CHAT,
                timeout=limit,
                **extra,
            ),
            timeout=limit + 1,
        )
    except Exception as exc:
        err = _map_error(exc)
        _log_error(err, exc)
        raise err from exc


# ---------------------------------------------------------------- local model (Ollama)

def _ollama_payload(messages: List[Dict[str, str]], *, temperature: Optional[float], max_tokens: Optional[int],
                    stream: bool, json_mode: bool = False) -> Dict[str, Any]:
    payload: Dict[str, Any] = {
        "model": OLLAMA_MODEL,
        "messages": messages,
        "stream": stream,
        "think": OLLAMA_THINK,
        "keep_alive": OLLAMA_KEEP_ALIVE,
        "options": {
            "temperature": TEMPERATURE if temperature is None else temperature,
            "num_predict": max_tokens or MAX_TOKENS_CHAT,
            "num_ctx": OLLAMA_NUM_CTX,
        },
    }
    if json_mode:
        payload["format"] = "json"
    return payload


_ollama_http: Optional[httpx.AsyncClient] = None


def _ollama_client() -> httpx.AsyncClient:
    """One client for all calls: keep-alive connections to Ollama instead of one per request."""
    global _ollama_http
    if _ollama_http is None:
        _ollama_http = httpx.AsyncClient(timeout=TIMEOUT_SEC)
    return _ollama_http


def _map_ollama_error(exc: Exception) -> LLMError:
    if isinstance(exc, LLMError):
        return exc
    if isinstance(exc, (asyncio.TimeoutError, httpx.TimeoutException)):
        return LLMTimeoutError("The local model timed out.")
    if isinstance(exc, httpx.ConnectError):
        return LLMError("Could not reach the local model (is Ollama running?).")
    if isinstance(exc, httpx.HTTPStatusError):
        # 404 from /api/chat means the model is not pulled.
        if exc.response.status_code == 404:
            return LLMError(f"The local model {OLLAMA_MODEL} is not installed (ollama pull {OLLAMA_MODEL}).")
        return LLMError(f"The local model returned HTTP {exc.response.status_code}.")
    return LLMError(f"Unexpected local model error ({type(exc).__name__}).")


async def _ollama_complete(messages: List[Dict[str, str]], *, temperature: Optional[float] = None,
                           max_tokens: Optional[int] = None, timeout: Optional[float] = None,
                           json_mode: bool = False) -> str:
    limit = timeout or TIMEOUT_SEC
    try:
        response = await asyncio.wait_for(
            _ollama_client().post(f"{OLLAMA_HOST}/api/chat", timeout=limit,
                                  json=_ollama_payload(messages, temperature=temperature, max_tokens=max_tokens,
                                                       stream=False, json_mode=json_mode)),
            timeout=limit + 1,
        )
        response.raise_for_status()
        body = response.json()
    except Exception as exc:
        err = _map_ollama_error(exc)
        _log_error(err, exc)
        raise err from exc
    return ((body.get("message") or {}).get("content") or "").strip()


async def _ollama_stream(messages: List[Dict[str, str]], *, temperature: Optional[float] = None,
                         max_tokens: Optional[int] = None, timeout: Optional[float] = None) -> AsyncIterator[str]:
    """Yields content deltas from Ollama's streaming /api/chat (one JSON object per line)."""
    limit = timeout or TIMEOUT_SEC
    try:
        async with _ollama_client().stream("POST", f"{OLLAMA_HOST}/api/chat", timeout=limit,
                                           json=_ollama_payload(messages, temperature=temperature,
                                                                max_tokens=max_tokens, stream=True)) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                if not line.strip():
                    continue
                try:
                    event = json.loads(line)
                except ValueError:
                    continue
                if event.get("error"):
                    raise LLMError("The local model reported an error.")
                delta = (event.get("message") or {}).get("content")
                if delta:
                    yield delta
                if event.get("done"):
                    return
    except Exception as exc:
        err = _map_ollama_error(exc)
        _log_error(err, exc)
        raise err from exc


def _content_of(response: Any) -> str:
    try:
        content = response.choices[0].message.content
    except (AttributeError, IndexError, TypeError):
        content = None
    return (content or '').strip()


DeltaCallback = Callable[[str], Awaitable[None]]


async def generate(prompt: Messages, generation_config_override=None, max_tokens: int = None,
                   timeout: Optional[float] = None, on_delta: Optional[DeltaCallback] = None) -> str:
    """Generates a text response. Raises LLMError subclasses on failure.

    With `on_delta` the answer is streamed: each piece of text is awaited through the callback as it
    arrives, and the full text is still returned at the end. Callers that only want the final text
    pass nothing and get the old non-streaming behaviour.
    """
    if on_delta is not None:
        parts: List[str] = []
        async for delta in generate_stream(prompt, max_tokens=max_tokens, timeout=timeout):
            parts.append(delta)
            await on_delta(delta)
        return "".join(parts).strip()

    if PROVIDER == 'ollama':
        return await _ollama_complete(_as_messages(prompt), max_tokens=max_tokens or MAX_TOKENS_CHAT,
                                      timeout=timeout)
    response = await _complete(_as_messages(prompt), model=None, temperature=None,
                               max_tokens=max_tokens or MAX_TOKENS_CHAT, timeout=timeout)
    return _content_of(response)


async def generate_json(messages: Messages, *, model: Optional[str] = None, temperature: Optional[float] = None,
                        max_tokens: Optional[int] = None, timeout: Optional[float] = None) -> Dict[str, Any]:
    """Generates a JSON object using Groq JSON mode (no streaming, no SDK retries).

    Raises LLMInvalidOutputError when the output is not a JSON object, plus the other LLMError subclasses.
    """
    msgs = _as_messages(messages)
    if not any('json' in (m.get('content') or '').lower() for m in msgs):
        msgs = [{"role": "system", "content": "Respond only with a valid JSON object."}] + msgs
    if PROVIDER == 'ollama':
        content = await _ollama_complete(msgs, temperature=temperature, max_tokens=max_tokens,
                                         timeout=timeout, json_mode=True)
        data = extract_json_object(content)
        if data is None:
            raise LLMInvalidOutputError("The model output is not a JSON object.", raw=content)
        return data
    try:
        response = await _complete(msgs, model=model, temperature=temperature, max_tokens=max_tokens,
                                   timeout=timeout, max_retries=0, response_format={"type": "json_object"})
    except LLMInvalidOutputError as exc:
        salvaged = extract_json_object(exc.raw)
        if salvaged is not None:
            return salvaged
        raise
    content = _content_of(response)
    data = extract_json_object(content)
    if data is None:
        raise LLMInvalidOutputError("The model output is not a JSON object.", raw=content)
    return data


def extract_json_object(text: Optional[str], max_attempts: int = 50) -> Optional[Dict[str, Any]]:
    """Returns the first JSON object found in `text` (plain, fenced or surrounded by prose), else None."""
    if not isinstance(text, str) or not text.strip():
        return None
    stripped = text.strip()
    fenced = re.match(r'^```[a-zA-Z]*\s*(.*?)\s*```$', stripped, re.DOTALL)
    if fenced:
        stripped = fenced.group(1)
    try:
        value = json.loads(stripped)
        return value if isinstance(value, dict) else None
    except ValueError:
        pass
    decoder = json.JSONDecoder()
    index = stripped.find('{')
    attempts = 0
    while index != -1 and attempts < max_attempts:
        attempts += 1
        try:
            value, _ = decoder.raw_decode(stripped, index)
            if isinstance(value, dict):
                return value
        except ValueError:
            pass
        index = stripped.find('{', index + 1)
    return None


async def generate_stream(prompt: Messages, generation_config_override=None, max_tokens: Optional[int] = None,
                          timeout: Optional[float] = None) -> AsyncIterator[str]:
    """Generates a streaming text response. Raises LLMError subclasses on failure."""
    if PROVIDER == 'ollama':
        async for delta in _ollama_stream(_as_messages(prompt), max_tokens=max_tokens, timeout=timeout):
            yield delta
        return
    extra: Dict[str, Any] = {}
    if REASONING_EFFORT and MODEL.startswith('openai/gpt-oss'):
        extra['reasoning_effort'] = REASONING_EFFORT
    try:
        stream = await _get_client().chat.completions.create(
            model=MODEL,
            messages=_as_messages(prompt),
            temperature=TEMPERATURE,
            max_tokens=max_tokens or MAX_TOKENS_CHAT,
            stream=True,
            timeout=timeout or TIMEOUT_SEC,
            **extra,
        )
        async for chunk in stream:
            choices = getattr(chunk, 'choices', None) or []
            delta = choices[0].delta.content if choices else None
            if delta:
                yield delta
    except Exception as exc:
        err = _map_error(exc)
        _log_error(err, exc)
        raise err from exc
