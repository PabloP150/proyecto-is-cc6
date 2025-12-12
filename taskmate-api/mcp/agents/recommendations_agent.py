import google.generativeai as genai
import llm_service

class RecommendationsAgent:
    def __init__(self):
        # Future: planning phases for multi-step interaction
        pass
    
    def _build_clarification_prompt(self, message: str):
        """Generates clarifying questions to better understand the project."""
        return (
            f"The user wants to create: '{message}'\n\n"
            "You are a project planning expert. Ask 3-5 focused clarifying questions to better understand this project. "
            "Focus on:\n"
            "1. Target audience and main use cases\n"
            "2. Key features and functionality\n"
            "3. Technical constraints or preferences\n"
            "4. Timeline and complexity expectations\n"
            "5. Success criteria\n\n"
            "Ask questions that will help create a more detailed and accurate project plan. "
            "Be conversational and helpful. End by saying you'll create a detailed plan once you understand their needs better."
        )
    
    def _build_comprehensive_plan_prompt(self, message: str, clarifications: str = ""):
        """Builds the enhanced prompt with milestone-focused structure."""
        return (
            f"You are an expert project manager and technical architect. Create a comprehensive project plan.\n\n"
            f"CRITICAL DATE CONTEXT: Today's date is December 11, 2025. All generated dates (start dates, end dates, deadlines) MUST be in the future relative to this date.\n\n"
            f"ORIGINAL REQUEST: '{message}'\n"
            f"ADDITIONAL CONTEXT: {clarifications}\n\n"
            
            "IMPORTANT: Structure this as MILESTONE-DRIVEN planning:\n"
            "- Milestones are the MAIN TASKS (major project phases)\n"
            "- Tasks are SUBTASKS that support milestone completion\n"
            "- Each milestone should represent a significant, demonstrable achievement\n"
            "- Tasks should be specific actions needed to reach each milestone\n\n"
            
            "CRITICAL DATABASE CONSTRAINTS - MUST FOLLOW EXACTLY:\n"
            "- project_name: MAXIMUM 25 characters (will be truncated if longer)\n"
            "- task names: MAXIMUM 25 characters each (will be truncated if longer)\n"
            "- task descriptions: MAXIMUM 1000 characters each\n"
            "- milestone names: MAXIMUM 25 characters each (will be truncated if longer)\n"
            "- milestone descriptions: MAXIMUM 1000 characters each\n"
            "- All dates must be in YYYY-MM-DD format (ISO date format)\n"
            "- Task status must be exactly 'To Do' (case sensitive)\n\n"
            
            "The response must be a JSON object with this structure:\n"
            "{\n"
            "  \"recommendations\": {\n"
            "    \"project_name\": \"Short name (MAX 25 chars)\",\n"
            "    \"project_description\": \"Clear 2-3 sentence description\",\n"
            "    \"project_type\": \"web_app|mobile_app|desktop_app|api|game|other\",\n"
            "    \"estimated_duration\": \"2-4 weeks|1-2 months|3-6 months|6+ months\",\n"
            "    \"difficulty_level\": \"beginner|intermediate|advanced\",\n"
            "    \"technology_stack\": {\n"
            "      \"frontend\": [\"Primary frontend tech\"],\n"
            "      \"backend\": [\"Backend/server tech\"],\n"
            "      \"database\": [\"Database solution\"],\n"
            "      \"tools\": [\"Development tools\"]\n"
            "    },\n"
            "    \"milestones\": [\n"
            "      {\n"
            "        \"id\": \"milestone_1\",\n"
            "        \"name\": \"Short Name (MAX 25 chars)\",\n"
            "        \"description\": \"Detailed description (MAX 1000 chars)\",\n"
            "        \"date\": \"YYYY-MM-DD\",\n"
            "        \"deliverables\": [\"Specific outputs from this milestone\"],\n"
            "        \"success_criteria\": \"How to know this milestone is complete\"\n"
            "      }\n"
            "    ],\n"
            "    \"tasks\": [\n"
            "      {\n"
            "        \"name\": \"Short Name (MAX 25 chars)\",\n"
            "        \"description\": \"Detailed description (MAX 1000 chars)\",\n"
            "        \"milestone_id\": \"milestone_1\",\n"
            "        \"category\": \"planning|design|development|testing|deployment\",\n"
            "        \"estimated_hours\": 4,\n"
            "        \"due_date\": \"YYYY-MM-DD\",\n"
            "        \"status\": \"To Do\",\n"
            "        \"dependencies\": [\"other_task_names_if_needed\"]\n"
            "      }\n"
            "    ],\n"
            "    \"project_phases\": {\n"
            "      \"phase_1\": \"Planning & Setup (Week 1)\",\n"
            "      \"phase_2\": \"Core Development (Weeks 2-4)\",\n"
            "      \"phase_3\": \"Testing & Deployment (Week 5)\"\n"
            "    },\n"
            "    \"considerations\": {\n"
            "      \"risks\": [\"Potential challenges or blockers\"],\n"
            "      \"requirements\": [\"Skills, tools, or resources needed\"],\n"
            "      \"success_criteria\": [\"How to measure overall project success\"]\n"
            "    }\n"
            "  }\n"
            "}\n\n"
            
            "MILESTONE PLANNING GUIDELINES:\n"
            "- Create 4-6 major milestones that represent project phases\n"
            "- Typical milestone progression: Setup → Design → Core Features → Advanced Features → Testing → Launch\n"
            "- Each milestone should be a significant achievement users can see/test\n"
            "- Space milestones evenly throughout the project timeline\n"
            "- Include clear success criteria for each milestone\n"
            "- CRITICAL: Keep milestone names under 25 characters (e.g., 'Setup Complete', 'Core Features Done')\n"
            "- CRITICAL: Keep milestone descriptions under 1000 characters\n"
            "- CRITICAL: Use YYYY-MM-DD format for all date fields\n\n"
            
            "TASK PLANNING GUIDELINES:\n"
            "- Create 3-5 tasks per milestone (12-25 total tasks)\n"
            "- Each task should take 2-8 hours to complete\n"
            "- Tasks must clearly support their assigned milestone\n"
            "- Include specific deliverables in task descriptions\n"
            "- Set realistic dependencies between tasks\n"
            "- Use categories to organize work types\n"
            "- CRITICAL: Keep task names under 25 characters (e.g., 'Setup Git Repo', 'Create UI Layout')\n"
            "- CRITICAL: Keep task descriptions under 1000 characters\n"
            "- CRITICAL: Use exact status 'To Do' for all tasks\n"
            "- CRITICAL: Use YYYY-MM-DD format for all due_date fields\n\n"
            
            "TECHNOLOGY RECOMMENDATIONS:\n"
            "- Choose technologies appropriate for project complexity and user skill level\n"
            "- For beginners: prefer simpler, well-documented technologies\n"
            "- For web apps: React/Vue + Node.js/Python + SQL/NoSQL database\n"
            "- For mobile: React Native (cross-platform) or native development\n"
            "- For desktop: Electron (web tech) or native frameworks\n"
            "- Always include essential development tools (Git, IDE, etc.)\n\n"
            
            "PROJECT NAMING GUIDELINES:\n"
            "- CRITICAL: Project name must be 25 characters or less\n"
            "- Use concise, descriptive names (e.g., 'Python Calculator', 'Todo Web App', 'Chat Bot API')\n"
            "- Avoid generic prefixes like 'Project:', 'Build a', 'Create'\n"
            "- Focus on the core functionality or product name\n\n"
            
            "PROJECT STRUCTURE:\n"
            "- Break project into logical phases with clear boundaries\n"
            "- Ensure each phase builds on the previous one\n"
            "- Include testing and validation throughout, not just at the end\n"
            "- Plan for iterative development with working prototypes\n\n"
            
            "Respond with ONLY the JSON object, no additional text."
        )

    async def handle(self, message: str, phase: str = 'final_plan', context: dict = None):
        """Enhanced handler that supports multi-phase planning."""
        if phase == 'clarification':
            prompt = self._build_clarification_prompt(message)
            generation_config = genai.types.GenerationConfig(temperature=0.3)
        else:
            # Default to comprehensive planning
            clarifications = context.get('clarifications', '') if context else ''
            prompt = self._build_comprehensive_plan_prompt(message, clarifications)
            generation_config = genai.types.GenerationConfig(
                temperature=0.2,
                response_mime_type='application/json'
            )

        return await llm_service.generate(prompt, generation_config_override=generation_config)
