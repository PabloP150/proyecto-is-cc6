import os
from groq import AsyncGroq
from dotenv import load_dotenv

load_dotenv()

API_KEY = os.getenv('GROQ_API_KEY', os.getenv('LLM_API_KEY'))
MODEL = os.getenv('LLM_MODEL', 'llama-3.3-70b-versatile')
TEMPERATURE = float(os.getenv('LLM_TEMPERATURE', 0.7))

if not API_KEY:
    raise ValueError("GROQ_API_KEY or LLM_API_KEY not found in environment.")

_client = AsyncGroq(api_key=API_KEY)

async def generate(prompt: str, generation_config_override=None) -> str:
    """Generates a non-streaming response from the model."""
    try:
        response = await _client.chat.completions.create(
            model=MODEL,
            messages=[{"role": "user", "content": prompt}],
            temperature=TEMPERATURE,
        )
        return response.choices[0].message.content.strip()
    except Exception as e:
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
