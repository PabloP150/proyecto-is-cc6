import os
import google.generativeai as genai
from dotenv import load_dotenv

class LLMService:
    def __init__(self):
        load_dotenv() # Load environment variables from .env file

        self.provider = os.getenv('LLM_PROVIDER', 'gemini')
        self.api_key = os.getenv('LLM_API_KEY')
        self.base_url = os.getenv('LLM_BASE_URL', 'https://generativelanguage.googleapis.com/v1beta')
        self.model_name = os.getenv('LLM_MODEL', 'gemini-1.5-flash')
        self.max_tokens = int(os.getenv('LLM_MAX_TOKENS', 2048))
        self.temperature = float(os.getenv('LLM_TEMPERATURE', 0.7))

        if not self.api_key:
            print('WARNING: LLM_API_KEY not configured. LLM service will use fallback responses.')

        genai.configure(api_key=self.api_key)
        self.model = genai.GenerativeModel(self.model_name)

    def _build_system_prompt(self, context):
        prompt = (
            "You are a helpful AI assistant for TaskMate, a task management application. "
            "You help users with task planning, organization, and productivity advice.\n\n"
            "Current user context:"
        )

        if context and context.get('tasks'):
            prompt += "\n\nUser's current tasks:"
            for i, task in enumerate(context['tasks']):
                prompt += f"\n{i + 1}. {task.get('title', '')}{ ' (completed)' if task.get('completed') else ''}"
                if task.get('description'):
                    prompt += f" - {task['description']}"

        if context and context.get('groups'):
            prompt += "\n\nUser's groups:"
            for i, group in enumerate(context['groups']):
                prompt += f"\n{i + 1}. {group.get('name', '')}"
                if group.get('description'):
                    prompt += f" - {group['description']}"

        prompt += (
            "\n\nProvide helpful, concise responses focused on task management and productivity. "
            "If the user asks about their specific tasks or groups, reference the context provided above."
        )
        return prompt

    async def generate_response(self, message, context=None):
        if context is None:
            context = {}
        try:
            if not self.api_key:
                return self._get_fallback_response(message)

            system_prompt = self._build_system_prompt(context)
            full_prompt = (f"{system_prompt}\n\nUser: {message}\n\n" +
                           "Please generate a structured JSON response for a project plan based on the user's idea. " +
                           "The JSON should contain 'project_name', 'project_description', 'tasks', and 'milestones'. " +
                           "Tasks should include 'name', 'description', 'due_date' (ISO 8601 format), and 'status' (e.g., \"To Do\"). " +
                           "Milestones should include 'name', 'description', and 'date' (YYYY-MM-DD format). " +
                           "Ensure all dates are realistic and in the future. " +
                           "Return ONLY the JSON object, no markdown formatting, no extra text, no explanations. " +
                           "Example: { \"project_name\": \"My Project\", \"project_description\": \"A description\", \"tasks\": [ { \"name\": \"Task 1\", \"description\": \"Desc 1\", \"due_date\": \"2025-12-31T23:59:59Z\", \"status\": \"To Do\" } ], \"milestones\": [ { \"name\": \"Milestone 1\", \"description\": \"Milestone Desc\", \"date\": \"2025-10-01\" } ] }")

            response = await self.model.generate_content_async(
                full_prompt,
                generation_config=genai.types.GenerationConfig(
                    temperature=0.2, # Lower temperature for structured output
                    max_output_tokens=self.max_tokens
                )
            )
            return response.text.strip()
        except Exception as e:
            print(f"LLM Service Error: {e}")
            return self._handle_error(e, message)

    async def classify_intent(self, message):
        try:
            if not self.api_key:
                raise Exception('LLM_API_KEY not configured.')

            system_prompt = (
                "You are an intent classifier for a task management chatbot. Classify the user's message into one of the following categories:\n"
                "- create_new_project: The user wants to create a new project, plan, or a set of tasks from an idea. Examples: \"I want to build a new website\", \"Plan a trip to Europe\", \"Help me organize a party\", \"I need a project plan for my new app\", \"Create a task list for my summer vacation\".\n"
                "- answer_question: The user is asking a question. Examples: \"What is TaskMate?\", \"How do I create a task?\", \"Can you tell me about groups?\".\n"
                "- general_conversation: The user is making a general statement or greeting. Examples: \"Hello\", \"How are you?\", \"Thanks\", \"Good morning\".\n\n"
                "Your response MUST be a single word, exactly one of the category names provided (e.g., \"create_new_project\"). Do NOT include any other text, punctuation, or explanation."
            )

            full_prompt = f"{system_prompt}\n\nUser: {message}"
            response = await self.model.generate_content_async(
                full_prompt,
                generation_config=genai.types.GenerationConfig(
                    temperature=0.1, # Lower temperature for classification
                    max_output_tokens=50 # Small output for single word
                )
            )
            raw_intent = response.text.strip()
            intent = raw_intent.split(' ')[0] # Take only the first word
            if intent in ['create_new_project', 'answer_question', 'general_conversation']:
                return intent
            return 'answer_question' # Default fallback
        except Exception as e:
            print(f"LLM Intent Classification Error: {e}")
            return 'answer_question' # Default fallback on error

    async def is_affirmative(self, message):
        try:
            if not self.api_key:
                raise Exception('LLM_API_KEY not configured.')

            system_prompt = (
                "You are a response classifier. The user was asked a yes/no question. Classify their response as \"affirmative\" or \"negative\". "
                "Respond with only the category name and nothing else."            )

            full_prompt = f"{system_prompt}\n\nUser: {message}"
            response = await self.model.generate_content_async(
                full_prompt,
                generation_config=genai.types.GenerationConfig(
                    temperature=0.1, # Lower temperature for classification
                    max_output_tokens=50 # Small output for single word
                )
            )
            classification = response.text.strip()
            return classification == 'affirmative'
        except Exception as e:
            print(f"LLM Affirmative Classification Error: {e}")
            return False # Default fallback on error

    def _handle_error(self, error, message):
        # Basic error handling, can be expanded
        return "I apologize, but I'm currently unable to process your request. Please try again later."

    def _get_fallback_response(self, message):
        # Basic fallback, can be expanded
        return "I apologize, but I'm currently unable to process your request. Please try again later."


llm_service_instance = LLMService()