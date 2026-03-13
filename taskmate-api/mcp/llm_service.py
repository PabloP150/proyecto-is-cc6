import os
from groq import AsyncGroq
from dotenv import load_dotenv

load_dotenv()

API_KEY = os.getenv('GROQ_API_KEY', os.getenv('LLM_API_KEY'))
MODEL = os.getenv('LLM_MODEL', 'llama-3.1-8b-instant')
TEMPERATURE = float(os.getenv('LLM_TEMPERATURE', 0.7))

if not API_KEY:
    raise ValueError("GROQ_API_KEY or LLM_API_KEY not found in environment.")

_client = AsyncGroq(api_key=API_KEY)

MAX_TOKENS_CHAT = int(os.getenv('LLM_MAX_TOKENS_CHAT', 1000))
MAX_TOKENS_PLAN = int(os.getenv('LLM_MAX_TOKENS_PLAN', 8192))

async def generate(prompt: str, generation_config_override=None, max_tokens: int = None) -> str:
    """Generates a non-streaming response from the model."""
    try:
        limit = max_tokens or MAX_TOKENS_CHAT
        response = await _client.chat.completions.create(
            model=MODEL,
            messages=[{"role": "user", "content": prompt}],
            temperature=TEMPERATURE,
            max_tokens=limit,
        )
        return response.choices[0].message.content.strip()
    except Exception as e:
        err_str = str(e)
        if '429' in err_str or 'rate_limit_exceeded' in err_str:
            import re
            m_s = re.search(r'try again in (\d+)m([\d.]+)s', err_str, re.IGNORECASE)
            only_s = re.search(r'try again in ([\d.]+)s', err_str, re.IGNORECASE)
            if m_s:
                wait = f"{m_s.group(1)}m {round(float(m_s.group(2)))}s"
            elif only_s:
                wait = f"{round(float(only_s.group(1)))}s"
            else:
                wait = 'a few minutes'
            print(f"LLM Rate Limit: retry in {wait}")
            return f"⏳ Rate limit reached. Try again in {wait}."
        print(f"LLM Generation Error: {e}")
        return f"Error during text generation: {e}"

async def generate_stream(prompt: str, generation_config_override=None):
    """Generates a streaming response from the model."""
    try:
        stream = await _client.chat.completions.create(
            model=MODEL,
            messages=[{"role": "user", "content": prompt}],
            temperature=TEMPERATURE,
            stream=True,
        )
        async for chunk in stream:
            delta = chunk.choices[0].delta.content
            if delta:
                yield delta
    except Exception as e:
        print(f"LLM Stream Error: {e}")
        yield f"Error during stream generation: {e}"
