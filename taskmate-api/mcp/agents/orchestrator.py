import json
import re
from datetime import date
from fastapi import WebSocket

import llm_service
from agents.recommendations_agent import RecommendationsAgent
from agents.analytics_agent import AnalyticsAgent

class OrchestratorAgent:
    def __init__(self):
        self.sessions = {}
        self.recommendations_agent = RecommendationsAgent()
        self.analytics_agent = AnalyticsAgent()

    def get_session_state(self, session_id: str):
        if session_id not in self.sessions:
            self.sessions[session_id] = {
                "conversation_history": [],
                "project_info": "",
                "waiting_for_confirmation": False
            }
        return self.sessions[session_id]

    def add_to_conversation(self, session_id: str, message: str, is_user: bool = True):
        """Add message to conversation history. Truncates long messages to avoid 413 errors."""
        state = self.get_session_state(session_id)
        speaker = "User" if is_user else "Assistant"
        truncated = message if len(message) <= 1000 else message[:1000] + "..."
        state["conversation_history"].append(f"{speaker}: {truncated}")
        if len(state["conversation_history"]) > 16:
            state["conversation_history"] = state["conversation_history"][-16:]

    def get_conversation_context(self, session_id: str) -> str:
        """Get recent conversation for context."""
        state = self.get_session_state(session_id)
        return "\n".join(state["conversation_history"][-10:])

    async def handle_message(self, session_id: str, websocket: WebSocket, request: dict):
        state = self.get_session_state(session_id)
        user_message = request.get("params", {}).get("message")
        request_id = request.get("requestId")
        today = date.today().strftime("%B %d, %Y")

        print(f"\n--- Orchestrator ---")
        print(f"[Session: {session_id}] Received message: '{user_message}'")

        # Check if this is an analytics request
        if request.get("type") == "analytics":
            return await self._handle_analytics_request(session_id, websocket, request)

        # Add user message to conversation history
        self.add_to_conversation(session_id, user_message, is_user=True)

        # Get conversation context
        conversation_context = self.get_conversation_context(session_id)

        # Check if waiting for confirmation to save plan
        confirm_phrases = [
            "yes", "ok", "sure", "save", "guardar", "sí", "si",
            "save the plan", "save this plan", "confirmo", "confirm",
            "go ahead", "adelante", "dale", "listo", "proceed", "procede",
            "yep", "yeah", "claro", "por supuesto",
        ]
        if state["waiting_for_confirmation"]:
            if any(p in user_message.lower() for p in confirm_phrases):
                response_data = {
                    "event": "save_plan",
                    "sessionId": session_id,
                    "data": {
                        "plan": state.get("generated_plan", {}),
                        "original_message": state["project_info"]
                    }
                }
                state["waiting_for_confirmation"] = False
                print(f"[Session: {session_id}] Saving plan")
                await websocket.send_json(response_data)
                return
            else:
                state["waiting_for_confirmation"] = False
                response_content = "No problem! What would you like to change about the project plan, or would you like to start over?"
        else:
            # Main conversation handling
            prompt = f"""You are a helpful project planning assistant. Guide users through a natural conversation to gather comprehensive project information before creating detailed plans.

CURRENT DATE: {today}

CONVERSATION CONTEXT:
{conversation_context}

USER'S CURRENT MESSAGE: "{user_message}"

THREE-STAGE PLANNING APPROACH:
1. **PROJECT BASICS** - Understand what they want to build, main purpose, target audience
2. **FEATURES & REQUIREMENTS** - Dive into specific functionality, user interactions, key features
3. **TECHNICAL DETAILS** - Discuss platform preferences, complexity, timeline, technology choices

CRITICAL RULES — follow strictly:
- NEVER repeat a question that was already asked or answered in the conversation context above. Read the conversation history carefully before asking anything.
- NEVER ask about something the user already provided information on. If the user already said the target audience is "all people", do NOT ask about target audience again.
- If the user has answered a question, move forward to the NEXT unanswered topic. Do NOT circle back.
- When the user says "decide tu", "you decide", "decide for me", "tú decides", "decide you" or similar — STOP asking questions about that topic. Make ALL decisions yourself based on best practices, state your decisions clearly, and move on to the next stage.
- If the user repeatedly says "decide you" or gives broad answers like "all of them", "everything", "all" — take that as a signal to STOP gathering requirements entirely. Instead, make all remaining decisions yourself, present a FINAL complete summary of the entire project, and tell the user to type "generate the plan" when ready. Do NOT ask any more questions.

CONVERSATION GUIDELINES:
- Have a natural, friendly conversation
- Ask follow-up questions ONLY about topics not yet covered
- Guide them through the three stages naturally
- Only suggest creating a plan when you have comprehensive information across all areas or if the user wants you to
- Be curious about their project and ask thoughtful questions
- Help them think through aspects they might not have considered
- Track which of the three stages have been covered and skip completed ones

FORMATTING RULES — follow strictly:
- Use ## headings to label each section (e.g. ## 📋 Summary, ## 💡 Recommendation)
- Keep body text SHORT — 2-3 sentences max per section
- When presenting options, use a compact markdown table
- Only add questions at the end if there are genuinely NEW topics to explore. If all three stages are covered or the user has delegated decisions, do NOT add questions — instead present the summary and tell them to type "generate the plan".
- When you do ask questions, end with a clearly separated block:

---
**❓ Quick questions:**
1. [First question]
2. [Second question] *(max 2 questions)*

- Bold the key word in each question so it's easy to scan

CURRENT FOCUS:
- If they just shared a basic project idea, ask about target users and main goals
- If you know the basics, explore specific features and functionality they envision
- If you have features, discuss technical preferences and constraints
- Only when all three areas are well-covered, offer to create the detailed plan
- If the user keeps delegating decisions, wrap up immediately with a complete summary

Be conversational, make progress each turn, and NEVER repeat yourself:"""

            # Generate response
            response = await llm_service.generate(prompt, max_tokens=llm_service.MAX_TOKENS_CHAT)

            # Check if we should generate a project plan
            should_generate_plan = await self._should_generate_plan(session_id, user_message, conversation_context)

            if should_generate_plan:
                # Accumulate project information
                if state["project_info"]:
                    state["project_info"] += f" {user_message}"
                else:
                    state["project_info"] = user_message

                print(f"[Session: {session_id}] Generating project plan...")

                try:
                    plan_response = await self.recommendations_agent.handle(state["project_info"])

                    # Clean up JSON response — handle code blocks and free text
                    stripped = plan_response.strip()
                    if stripped.startswith("```json"):
                        stripped = stripped[7:]
                        stripped = stripped[:stripped.rfind("```")] if "```" in stripped else stripped
                    elif stripped.startswith("```"):
                        stripped = stripped[3:]
                        stripped = stripped[:stripped.rfind("```")] if "```" in stripped else stripped
                    else:
                        match = re.search(r'\{.*\}', stripped, re.DOTALL)
                        if match:
                            stripped = match.group(0)

                    plan_data = json.loads(stripped.strip())
                    state["generated_plan"] = plan_data
                    state["waiting_for_confirmation"] = True

                    # Human-readable summary instead of raw JSON
                    recs = plan_data.get("recommendations", plan_data)
                    project_name  = recs.get("project_name", "Your Project")
                    task_count    = len(recs.get("tasks", []))
                    milestones    = recs.get("milestones", [])
                    roles         = recs.get("roles", [])
                    tech          = recs.get("technology_stack", {})
                    all_tech      = tech.get("frontend", []) + tech.get("backend", []) + tech.get("database", [])
                    tech_str      = ", ".join(all_tech[:6]) if all_tech else "N/A"
                    role_lines    = "  ".join(f"{r.get('icon','')} **{r.get('name','')}**" for r in roles)
                    milestone_rows = "\n".join(
                        f"| {m.get('name','?')} | {m.get('date','?')} | {m.get('description','')[:70]} |"
                        for m in milestones
                    )

                    response_content = (
                        f"## ✅ Project Plan Ready: **{project_name}**\n\n"
                        f"Your complete project plan has been generated. Here's the summary:\n\n"
                        f"| Detail | Info |\n"
                        f"| --- | --- |\n"
                        f"| 📋 Total Tasks | **{task_count}** tasks across all milestones |\n"
                        f"| 🏁 Milestones | **{len(milestones)}** phases |\n"
                        f"| 🛠️ Tech Stack | {tech_str} |\n\n"
                        f"### 👥 Team Roles\n{role_lines}\n\n"
                        f"### 📅 Timeline\n"
                        f"| Milestone | Target Date | Description |\n"
                        f"| --- | --- | --- |\n"
                        f"{milestone_rows}\n\n"
                        f"---\n"
                        f"Would you like me to **save this plan** to your workspace? Type **yes** to confirm or **no** to make changes."
                    )

                except json.JSONDecodeError as e:
                    print(f"[Session: {session_id}] Error parsing plan JSON: {e}")
                    response_content = "I had trouble generating the project plan. Could you provide a bit more detail about what you want to build?"
            else:
                # Regular conversation - accumulate project info if relevant
                if self._is_project_related(user_message):
                    if state["project_info"]:
                        state["project_info"] += f" {user_message}"
                    else:
                        state["project_info"] = user_message

                response_content = response

        # Add assistant response to conversation history
        self.add_to_conversation(session_id, response_content, is_user=False)

        print(f"[Session: {session_id}] Sending response")
        await websocket.send_json({
            "event": "response",
            "data": {"content": response_content},
            "requestId": request_id,
            "sessionId": session_id
        })

    async def _should_generate_plan(self, session_id: str, message: str, context: str) -> bool:
        """Determine if we have enough information to generate a project plan."""
        state = self.get_session_state(session_id)

        if state["waiting_for_confirmation"]:
            return False

        # Explicit trigger phrases — generate immediately without LLM check
        trigger_phrases = [
            "generate the plan", "create the plan", "make the plan", "build the plan",
            "generate a plan", "create a plan", "genera el plan", "crea el plan",
            "genera el proyecto", "crea el proyecto", "hazlo", "procede",
            "listo para crear", "generate it", "create it", "just do it",
            "generate it now", "dale", "vamos a crear", "generar plan", "crear plan",
        ]
        if any(p in message.lower() for p in trigger_phrases):
            return True

        # LLM check — does the conversation have enough info?
        prompt = f"""Analyze if the user has provided COMPREHENSIVE information across these three key areas to create a detailed project plan:

1. **PROJECT BASICS**: What they want to build, main purpose, target users
2. **FEATURES & REQUIREMENTS**: Key functionality, specific features, user interactions
3. **TECHNICAL PREFERENCES**: Platform preferences, complexity level, timeline expectations

CONVERSATION CONTEXT:
{context}

CURRENT MESSAGE: "{message}"

ACCUMULATED PROJECT INFO: "{state['project_info']}"

Respond with "YES" ONLY if:
- All three areas above have been discussed with sufficient detail
- The user has provided specific features and functionality requirements
- There's enough information to create a comprehensive technical plan
- The conversation has naturally progressed through requirements gathering

Respond with "NO" if:
- Missing details in any of the three key areas
- Only basic project idea has been shared
- Need more clarification on features, technical aspects, or requirements
- The conversation is still in early stages

Respond with ONLY: YES or NO"""

        response = await llm_service.generate(prompt, max_tokens=10)
        return "YES" in response.upper()

    def _is_project_related(self, message: str) -> bool:
        """Simple check if message contains project-related information."""
        project_keywords = [
            "app", "website", "build", "create", "develop", "project",
            "feature", "user", "system", "platform", "tool", "application"
        ]
        return any(keyword in message.lower() for keyword in project_keywords)

    async def _handle_analytics_request(self, session_id: str, websocket: WebSocket, request: dict):
        """Handle analytics-specific requests."""
        try:
            action = request.get("action")
            data = request.get("data", {})
            request_id = request.get("requestId")

            print(f"[Session: {session_id}] Analytics request - Action: {action}")

            analytics_response = await self.analytics_agent.handle(action, data)

            print(f"[Session: {session_id}] Sending analytics response")
            await websocket.send_json({
                "event": "analytics_response",
                "sessionId": session_id,
                "requestId": request_id,
                "data": analytics_response
            })

        except Exception as e:
            error_message = f"Analytics request failed: {str(e)}"
            print(f"[Session: {session_id}] {error_message}")
            await websocket.send_json({
                "event": "analytics_error",
                "sessionId": session_id,
                "requestId": request.get("requestId"),
                "error": error_message
            })

orchestrator = OrchestratorAgent()
