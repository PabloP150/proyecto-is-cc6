from datetime import date
import llm_service

class RecommendationsAgent:
    def __init__(self):
        pass

    def _build_comprehensive_plan_prompt(self, message: str, clarifications: str = ""):
        today = date.today().strftime('%Y-%m-%d')
        return (
            f"You are an expert project manager. Today: {today}. All dates must be future dates in YYYY-MM-DD format.\n"
            f"Create a detailed project plan for: '{message}'\n"
            f"Context: {clarifications}\n\n"
            "STRICT RULES — follow exactly:\n"
            "- project_name: max 25 chars\n"
            "- task/milestone names: max 25 chars\n"
            "- role names: max 30 chars\n"
            "- EXACTLY 4 milestones: id=m1 name=Setup, id=m2 name=Development, id=m3 name=Testing, id=m4 name=Launch\n"
            "- Generate the number of tasks that the project ACTUALLY NEEDS based on its scope and complexity. A simple project may need 40-50 tasks, a complex one 80-120+. Use your judgment as a project manager.\n"
            "- MINIMUM 50 tasks. There is NO maximum — generate as many as the project requires.\n"
            "- Distribute tasks proportionally across milestones: ~20% Setup, ~40% Development, ~25% Testing, ~15% Launch\n"
            "- Distribute tasks across lists: Planning, Design, Development, Testing, Deployment\n"
            "- task list mapping: planning→Planning, design→Design, dev→Development, test→Testing, release→Deployment\n"
            "- task names: max 25 chars, specific and descriptive\n"
            "- task descriptions: 8-12 words, concise and actionable\n"
            "- Generate as many team roles as the project needs (minimum 3, no maximum). A small project may need 3-5 roles, a complex one 6-12+.\n"
            "- Each role must have a hex color and a Material Icons name as icon (e.g. 'code', 'build', 'bug_report', 'cloud', 'person', 'dashboard', 'terminal', 'edit', 'settings', 'group', 'star', 'api', 'storage', 'extension', 'insights', 'timeline', 'lock', 'public', 'visibility', 'chat'). Do NOT use emojis for icons.\n"
            "- DO NOT stop early. Output ALL tasks you planned. If you generate fewer than 50, the output is INVALID.\n"
            "- Keep the JSON compact: no extra whitespace, no newlines inside the JSON.\n\n"
            'Return ONLY valid JSON (no markdown, no extra text):\n'
            '{"recommendations":{"project_name":"...","project_description":"...","project_type":"web_app|mobile_app|api|game|other","estimated_duration":"...","difficulty_level":"beginner|intermediate|advanced","technology_stack":{"frontend":[],"backend":[],"database":[],"tools":[]},'
            '"roles":[{"name":"...","color":"#hex","icon":"emoji"}],'
            '"milestones":[{"id":"m1","name":"Setup","description":"...","date":"YYYY-MM-DD"},{"id":"m2","name":"Development","description":"...","date":"YYYY-MM-DD"},{"id":"m3","name":"Testing","description":"...","date":"YYYY-MM-DD"},{"id":"m4","name":"Launch","description":"...","date":"YYYY-MM-DD"}],'
            '"tasks":[{"name":"...","description":"...","milestone_id":"m1","list":"Planning","category":"planning","estimated_hours":4,"due_date":"YYYY-MM-DD"}],'
            '"considerations":{"risks":[],"requirements":[],"success_criteria":[]}}}'
        )

    async def handle(self, message: str, phase: str = 'final_plan', context: dict = None):
        clarifications = context.get('clarifications', '') if context else ''
        prompt = self._build_comprehensive_plan_prompt(message, clarifications)
        return await llm_service.generate(prompt, max_tokens=llm_service.MAX_TOKENS_PLAN)
