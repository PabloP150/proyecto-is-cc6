import os
import google.generativeai as genai
from dotenv import load_dotenv

# Load environment variables at the module level
load_dotenv()
API_KEY = os.getenv('GOOGLE_API_KEY', os.getenv('LLM_API_KEY'))

def get_configured_model(model_name_override=None):
    """Creates and returns a model instance with explicit configuration."""
    if not API_KEY:
        raise ValueError("GOOGLE_API_KEY or LLM_API_KEY not found in environment.")
    
    genai.configure(api_key=API_KEY)
    
    model_name = model_name_override or os.getenv('LLM_MODEL', 'gemini-2.5-flash')
    return genai.GenerativeModel(model_name)

async def generate(prompt: str, generation_config_override: dict = None) -> str:
    """Generates a non-streaming response from the model."""
    try:
        model = get_configured_model()
        response = await model.generate_content_async(
            prompt,
            generation_config=generation_config_override
        )
        
        # Debug: Print response details when blocked
        if not response.parts:
            print(f"Content blocked or empty response:")
            print(f"  - Prompt: {prompt[:100]}...")
            print(f"  - Response: {response}")
            print(f"  - Candidates: {getattr(response, 'candidates', 'None')}")
            if hasattr(response, 'prompt_feedback'):
                print(f"  - Prompt feedback: {response.prompt_feedback}")
        
        if response.parts:
            return response.parts[0].text.strip()
        return "" # Return empty string if blocked
    except Exception as e:
        print(f"LLM Generation Error: {e}")
        return f"Error during text generation: {e}"

async def generate_stream(prompt: str, generation_config_override: dict = None):
    """Generates a streaming response from the model."""
    try:
        model = get_configured_model()
        response_stream = await model.generate_content_async(
            prompt,
            stream=True,
            generation_config=generation_config_override
        )
        async for chunk in response_stream:
            if chunk.parts:
                yield chunk.parts[0].text
    except Exception as e:
        print(f"LLM Stream Error: {e}")
        yield f"Error during stream generation: {e}"
