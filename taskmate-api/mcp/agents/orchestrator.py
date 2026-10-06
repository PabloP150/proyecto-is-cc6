import logging
import os
import re
import time
import unicodedata
from collections import OrderedDict
from datetime import date
from typing import Any, Dict, Optional

import llm_service
from agents.recommendations_agent import RecommendationsAgent
from agents.analytics_agent import AnalyticsAgent
from agents.repo_analysis_agent import RepoAnalysisAgent, RepoAnalysisError

logger = logging.getLogger(__name__)

SESSION_TTL_SEC = float(os.getenv('MCP_SESSION_TTL_SEC', 2 * 60 * 60))
MAX_SESSIONS = int(os.getenv('MCP_MAX_SESSIONS', 1000))
# How long a confirmed plan waits for Node's save_plan_result before the user can retry.
PENDING_SAVE_TTL_SEC = float(os.getenv('MCP_PENDING_SAVE_TTL_SEC', 60))
PURGE_INTERVAL_SEC = 60.0
MAX_USER_MESSAGE_CHARS = 4000
PROJECT_INFO_MAX_CHARS = 4000

CONFIRM, DISCARD, REJECT, CHANGE = 'confirm', 'discard', 'reject', 'change'

_CONFIRM_PHRASES = (
    "yes", "ok", "okay", "sure", "save", "save it", "save the plan", "save this plan", "confirm", "confirmed",
    "go ahead", "proceed", "yep", "yeah", "of course", "si", "claro", "guardar", "guarda", "guardalo", "guardala",
    "confirmo", "confirmar", "confirmado", "adelante", "dale", "listo", "procede", "por supuesto", "de acuerdo",
    "perfecto", "hazlo",
)
_NEGATION_PHRASES = (
    "no", "nope", "nah", "not", "dont", "don t", "do not", "cancel", "stop", "wait", "change", "modify",
    "never", "cancela", "cancelar", "espera", "cambia", "cambiar", "cambialo", "modifica", "modificar", "nunca",
    "tampoco",
)
_DISCARD_PHRASES = (
    "start over", "start again", "discard", "discard it", "forget it", "cancel", "empezar de nuevo",
    "empecemos de nuevo", "desde cero", "descarta", "descartalo", "descartar", "olvidalo", "cancela", "cancelar",
)
# A rejection made only of these words carries no change request worth answering with the LLM.
_BARE_REJECTION_WORDS = {
    "no", "nope", "nah", "not", "now", "yet", "thanks", "thank", "you", "please", "ahora", "todavia", "aun",
    "gracias", "por", "favor", "mejor", "asi", "cancel", "cancela", "cancelar",
}
_PLAN_TRIGGER_PHRASES = (
    "generate the plan", "create the plan", "make the plan", "build the plan", "generate a plan", "create a plan",
    "genera el plan", "crea el plan", "genera el proyecto", "crea el proyecto", "hazlo", "procede",
    "listo para crear", "generate it", "create it", "just do it", "generate it now", "dale", "vamos a crear",
    "generar plan", "crear plan",
)


def normalize_text(text: str) -> str:
    """Lowercase, accent-free, punctuation-free text padded with spaces for whole-phrase matching."""
    decomposed = unicodedata.normalize('NFKD', text or '')
    without_marks = ''.join(ch for ch in decomposed if not unicodedata.combining(ch))
    return ' %s ' % ' '.join(re.sub(r'[^\w]+', ' ', without_marks.casefold()).split())


def contains_phrase(text: str, phrases) -> bool:
    normalized = normalize_text(text)
    return any(' %s ' % phrase in normalized for phrase in phrases)


def classify_confirmation(message: str) -> str:
    """Decides what a reply to "save this plan?" means, matching whole words only."""
    if contains_phrase(message, _DISCARD_PHRASES):
        return DISCARD
    negated = contains_phrase(message, _NEGATION_PHRASES)
    if contains_phrase(message, _CONFIRM_PHRASES) and not negated:
        return CONFIRM
    words = normalize_text(message).split()
    if negated and all(word in _BARE_REJECTION_WORDS for word in words):
        return REJECT
    return CHANGE


def friendly_llm_error(exc: llm_service.LLMError) -> str:
    if isinstance(exc, llm_service.LLMRateLimitError):
        wait = _format_wait(exc.retry_after)
        return f"The AI assistant is receiving too many requests right now. Please try again in {wait}."
    if isinstance(exc, llm_service.LLMTimeoutError):
        return "The AI assistant took too long to respond. Please try again."
    if isinstance(exc, llm_service.LLMInvalidOutputError):
        return "I had trouble understanding the AI response. Please try again."
    return "The AI assistant is temporarily unavailable. Please try again in a moment."


def _format_wait(seconds: Optional[float]) -> str:
    if seconds is None:
        return "a minute"
    total = max(1, int(round(seconds)))
    minutes, secs = divmod(total, 60)
    return f"{minutes}m {secs}s" if minutes else f"{secs}s"


def cap_project_info(text: str) -> str:
    """Keeps the original idea and the latest refinements when the accumulated description grows too long."""
    if len(text) <= PROJECT_INFO_MAX_CHARS:
        return text
    half = PROJECT_INFO_MAX_CHARS // 2
    return text[:half].rstrip() + " ... " + text[-half:].lstrip()


def _error_details(exc: llm_service.LLMError) -> Dict[str, Any]:
    details: Dict[str, Any] = {"code": exc.code}
    if isinstance(exc, llm_service.LLMRateLimitError) and exc.retry_after is not None:
        details["retryAfterSec"] = max(1, int(round(exc.retry_after)))
    return details


class OrchestratorAgent:
    def __init__(self, session_ttl_sec: Optional[float] = None, max_sessions: Optional[int] = None,
                 pending_save_ttl_sec: Optional[float] = None):
        self.sessions: "OrderedDict[str, Dict[str, Any]]" = OrderedDict()  # least recently used first
        self.session_ttl_sec = SESSION_TTL_SEC if session_ttl_sec is None else session_ttl_sec
        self.max_sessions = MAX_SESSIONS if max_sessions is None else max_sessions
        self.pending_save_ttl_sec = PENDING_SAVE_TTL_SEC if pending_save_ttl_sec is None else pending_save_ttl_sec
        self._last_purge = time.monotonic()
        self.recommendations_agent = RecommendationsAgent()
        self.analytics_agent = AnalyticsAgent()
        self.repo_analysis_agent = RepoAnalysisAgent()

    def get_session_state(self, session_id: str):
        now = time.monotonic()
        if now - self._last_purge >= PURGE_INTERVAL_SEC:
            self.purge_expired_sessions(now)
        state = self.sessions.get(session_id)
        if state is None:
            state = self.sessions[session_id] = {
                "conversation_history": [],
                "project_info": "",
                "generated_plan": None,
                "waiting_for_confirmation": False,
                "pending_save": None,
            }
            while len(self.sessions) > self.max_sessions:
                evicted, _ = self.sessions.popitem(last=False)
                logger.info("Evicted least recently used session %s (limit %d)", evicted, self.max_sessions)
        else:
            self.sessions.move_to_end(session_id)
        state["last_seen"] = now
        return state

    def purge_expired_sessions(self, now: Optional[float] = None) -> int:
        """Drops conversation state idle for longer than the TTL (Node may reconnect meanwhile)."""
        now = time.monotonic() if now is None else now
        self._last_purge = now
        expired = [sid for sid, state in self.sessions.items()
                   if now - state.get("last_seen", now) > self.session_ttl_sec]
        for sid in expired:
            del self.sessions[sid]
        if expired:
            logger.info("Purged %d idle sessions", len(expired))
        return len(expired)

    @staticmethod
    def clear_plan_state(state: Dict[str, Any], keep_project_info: bool = False) -> None:
        state["generated_plan"] = None
        state["waiting_for_confirmation"] = False
        state["pending_save"] = None
        if not keep_project_info:
            state["project_info"] = ""

    @staticmethod
    def _restore_pending_plan(state: Dict[str, Any]) -> None:
        pending = state.get("pending_save") or {}
        state["pending_save"] = None
        state["generated_plan"] = pending.get("plan")
        state["waiting_for_confirmation"] = True

    @staticmethod
    def requires_session_lock(request: Dict[str, Any]) -> bool:
        """Only conversation messages touch session state; analytics and repo analysis are stateless."""
        return request.get("type") != "analytics" and request.get("method") != "analyze_repository"

    @staticmethod
    def error_reply(session_id: Optional[str], request: Dict[str, Any], message: str,
                    code: Optional[str] = None) -> Dict[str, Any]:
        base = {"sessionId": session_id, "requestId": request.get("requestId")}
        if request.get("method") == "analyze_repository":
            return {"event": "repo_analysis_error", **base, "error": {"code": code or "INTERNAL_ERROR", "message": message}}
        reply = {"event": "analytics_error" if request.get("type") == "analytics" else "error", **base, "error": message}
        if code:
            reply["code"] = code
        return reply

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

    async def handle_message(self, session_id: str, websocket, request: dict):
        """Routes one request. `websocket` is anything with an async `send_json(dict)`."""
        if request.get("type") == "analytics":
            return await self._handle_analytics_request(session_id, websocket, request)

        method = request.get("method") or "handle_user_message"
        if method == "analyze_repository":
            return await self._handle_repo_analysis(session_id, websocket, request)
        if method == "save_plan_result":
            return self._handle_save_plan_result(session_id, request)
        if method != "handle_user_message":
            await websocket.send_json({"event": "error", "sessionId": session_id,
                                       "requestId": request.get("requestId"), "error": f"Unknown method: {method}"})
            return
        return await self._handle_user_message(session_id, websocket, request)

    async def _reply(self, websocket, session_id: str, request_id, content: str,
                     error: Optional[llm_service.LLMError] = None, extra: Optional[Dict[str, Any]] = None,
                     record: bool = True) -> None:
        data: Dict[str, Any] = {"content": content}
        if extra:
            data.update(extra)
        if error is not None:
            data["error"] = _error_details(error)
        elif record:
            self.add_to_conversation(session_id, content, is_user=False)
        await websocket.send_json({"event": "response", "data": data, "requestId": request_id, "sessionId": session_id})

    def _discard_last_user_turn(self, session_id: str) -> None:
        history = self.get_session_state(session_id)["conversation_history"]
        if history and history[-1].startswith("User: "):
            history.pop()

    async def _handle_user_message(self, session_id: str, websocket, request: dict):
        params = request.get("params") if isinstance(request.get("params"), dict) else {}
        user_message = params.get("message")
        request_id = request.get("requestId")
        if not isinstance(user_message, str) or not user_message.strip():
            await websocket.send_json(self.error_reply(session_id, request, "Message is required."))
            return
        if len(user_message) > MAX_USER_MESSAGE_CHARS:
            await websocket.send_json(self.error_reply(
                session_id, request, f"The message is too long (maximum {MAX_USER_MESSAGE_CHARS} characters).",
                code="MESSAGE_TOO_LONG"))
            return

        state = self.get_session_state(session_id)
        logger.debug("[Session: %s] Received user message (%d chars)", session_id, len(user_message))

        pending = state.get("pending_save")
        if pending:
            if time.monotonic() - pending["since"] < self.pending_save_ttl_sec:
                await self._reply(websocket, session_id, request_id,
                                  "I'm still saving your project plan. One moment, please.", record=False)
                return
            logger.warning("[Session: %s] No save_plan_result arrived in time; the plan awaits confirmation again",
                           session_id)
            self._restore_pending_plan(state)
            await self._reply(websocket, session_id, request_id,
                              "I couldn't confirm whether your project plan was saved. Check your projects, then type "
                              "**yes** to try saving it again or **no** to discard it.",
                              extra={"awaiting_confirmation": True})
            return

        self.add_to_conversation(session_id, user_message, is_user=True)

        if state["waiting_for_confirmation"]:
            decision = classify_confirmation(user_message)
            if decision == CONFIRM:
                # Nothing is recorded as saved until Node reports the outcome with save_plan_result.
                state["pending_save"] = {"plan": state.get("generated_plan") or {},
                                         "original_message": state["project_info"],
                                         "since": time.monotonic()}
                state["generated_plan"] = None
                state["waiting_for_confirmation"] = False
                logger.info("[Session: %s] Plan confirmed; asking Node to save it", session_id)
                await websocket.send_json({
                    "event": "save_plan",
                    "sessionId": session_id,
                    "requestId": request_id,
                    "data": {
                        "plan": state["pending_save"]["plan"],
                        "original_message": state["pending_save"]["original_message"]
                    }
                })
                return
            if decision == DISCARD:
                self.clear_plan_state(state)
                state["conversation_history"] = []
                await self._reply(websocket, session_id, request_id,
                                  "No problem! I discarded that plan. What would you like to build?")
                return
            # The pending plan is withdrawn either way; the project details stay so changes build on them.
            self.clear_plan_state(state, keep_project_info=True)
            if decision == REJECT:
                await self._reply(websocket, session_id, request_id,
                                  "No problem! What would you like to change about the project plan, or would you like to start over?")
                return

        conversation_context = self.get_conversation_context(session_id)
        try:
            if await self._should_generate_plan(session_id, user_message, conversation_context):
                response_content = await self._generate_plan(session_id, state, user_message)
            else:
                response_content = await self._chat_reply(state, user_message, conversation_context)
        except llm_service.LLMError as exc:
            self._discard_last_user_turn(session_id)
            await self._reply(websocket, session_id, request_id, friendly_llm_error(exc), error=exc)
            return

        logger.debug("[Session: %s] Sending response", session_id)
        await self._reply(websocket, session_id, request_id, response_content,
                          extra={"awaiting_confirmation": True} if state["waiting_for_confirmation"] else None)

    def _handle_save_plan_result(self, session_id: str, request: dict) -> None:
        """Node's report after a save_plan. It is a notification: no reply is sent."""
        params = request.get("params") if isinstance(request.get("params"), dict) else {}
        state = self.sessions.get(session_id)
        if state is None or not state.get("pending_save"):
            logger.info("[Session: %s] save_plan_result without a pending save; ignored", session_id)
            return
        self.get_session_state(session_id)
        if params.get("success") is True:
            group_name = str(params.get("groupName") or "")[:100]
            note = (f'The project plan was saved to the workspace as "{group_name}".' if group_name
                    else "The project plan was saved to the workspace.")
            # A saved project starts a fresh conversation, otherwise the old context would make the
            # "enough information?" check fire immediately for the next project.
            self.clear_plan_state(state)
            state["conversation_history"] = [f"Assistant: {note}"]
            logger.info("[Session: %s] Node saved the plan", session_id)
            return
        logger.warning("[Session: %s] Node could not save the plan (%s)", session_id, params.get("errorCode"))
        self._restore_pending_plan(state)
        self.add_to_conversation(session_id, "Saving the project plan failed; it is waiting for confirmation again.",
                                 is_user=False)

    async def _chat_reply(self, state: Dict[str, Any], user_message: str, conversation_context: str) -> str:
        today = date.today().strftime("%B %d, %Y")
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

        response = await llm_service.generate(prompt, max_tokens=llm_service.MAX_TOKENS_CHAT)
        if self._is_project_related(user_message):
            self._accumulate_project_info(state, user_message)
        return response

    @staticmethod
    def _accumulate_project_info(state: Dict[str, Any], user_message: str) -> None:
        state["project_info"] = cap_project_info(
            f"{state['project_info']} {user_message}" if state["project_info"] else user_message)

    async def _generate_plan(self, session_id: str, state: Dict[str, Any], user_message: str) -> str:
        project_info = cap_project_info(
            f"{state['project_info']} {user_message}" if state["project_info"] else user_message)
        logger.info("[Session: %s] Generating project plan", session_id)
        try:
            plan_data = await self.recommendations_agent.handle(project_info)
            summary = self._summarize_plan(plan_data)
        except llm_service.LLMInvalidOutputError:
            logger.warning("[Session: %s] The model returned an unusable project plan", session_id)
            state["project_info"] = project_info
            return "I had trouble generating the project plan. Could you provide a bit more detail about what you want to build?"
        state["project_info"] = project_info
        state["generated_plan"] = plan_data
        state["waiting_for_confirmation"] = True
        return summary

    @staticmethod
    def _summarize_plan(plan_data: Any) -> str:
        """Human-readable summary instead of raw JSON. Raises LLMInvalidOutputError for unusable plans."""
        recs = plan_data.get("recommendations", plan_data) if isinstance(plan_data, dict) else None
        if not isinstance(recs, dict) or not isinstance(recs.get("tasks"), list):
            raise llm_service.LLMInvalidOutputError("The project plan has no task list.")

        def items(value) -> list:
            return [item for item in value if isinstance(item, dict)] if isinstance(value, list) else []

        def names(value) -> list:
            return [str(item) for item in value if isinstance(item, (str, int, float))] if isinstance(value, list) else []

        project_name = recs.get("project_name") or "Your Project"
        task_count = len(recs["tasks"])
        milestones = items(recs.get("milestones"))
        roles = items(recs.get("roles"))
        tech = recs.get("technology_stack") if isinstance(recs.get("technology_stack"), dict) else {}
        all_tech = names(tech.get("frontend")) + names(tech.get("backend")) + names(tech.get("database"))
        tech_str = ", ".join(all_tech[:6]) if all_tech else "N/A"
        role_lines = "  ".join(f"{r.get('icon','')} **{r.get('name','')}**" for r in roles)
        milestone_rows = "\n".join(
            f"| {m.get('name','?')} | {m.get('date','?')} | {str(m.get('description',''))[:70]} |"
            for m in milestones
        )

        return (
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

    async def _should_generate_plan(self, session_id: str, message: str, context: str) -> bool:
        """Determine if we have enough information to generate a project plan."""
        state = self.get_session_state(session_id)

        if state["waiting_for_confirmation"]:
            return False

        # Explicit trigger phrases (whole words) — generate immediately without LLM check
        if contains_phrase(message, _PLAN_TRIGGER_PHRASES):
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

    async def _handle_analytics_request(self, session_id: str, websocket, request: dict):
        """Handle analytics-specific requests."""
        action = request.get("action")
        request_id = request.get("requestId")
        data = request.get("data") if isinstance(request.get("data"), dict) else {}
        logger.debug("[Session: %s] Analytics request - Action: %s", session_id, action)
        try:
            analytics_response = await self.analytics_agent.handle(action, data)
        except Exception:
            logger.exception("[Session: %s] Analytics request %s failed", session_id, action)
            await websocket.send_json({
                "event": "analytics_error",
                "sessionId": session_id,
                "requestId": request_id,
                "error": "Analytics request failed."
            })
            return
        await websocket.send_json({
            "event": "analytics_response",
            "sessionId": session_id,
            "requestId": request_id,
            "data": analytics_response
        })

    async def _handle_repo_analysis(self, session_id: str, websocket, request: dict):
        request_id = request.get("requestId")
        base = {"requestId": request_id, "sessionId": session_id}
        try:
            plan = await self.repo_analysis_agent.analyze(request.get("params"))
        except RepoAnalysisError as exc:
            logger.info("[Session: %s] Repo analysis %s failed: %s", session_id, request_id, exc.code)
            reply = {"event": "repo_analysis_error", **base, "error": exc.to_dict()}
        except Exception:
            logger.exception("[Session: %s] Repo analysis %s crashed", session_id, request_id)
            reply = {"event": "repo_analysis_error", **base,
                     "error": {"code": "INTERNAL_ERROR", "message": "No se pudo analizar el repositorio."}}
        else:
            reply = {"event": "repo_analysis_plan", **base, "data": {"plan": plan}}
        await websocket.send_json(reply)


orchestrator = OrchestratorAgent()
