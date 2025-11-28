import json
from fastapi import WebSocket
import google.generativeai as genai

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
                "conversation_history": [],  # Simple conversation memory
                "project_info": "",  # Accumulated project information
                "waiting_for_confirmation": False
            }
        return self.sessions[session_id]

    def add_to_conversation(self, session_id: str, message: str, is_user: bool = True):
        """Add message to conversation history, keep last 10 messages."""
        state = self.get_session_state(session_id)
        speaker = "User" if is_user else "Assistant"
        state["conversation_history"].append(f"{speaker}: {message}")
        
        # Keep only last 20 messages
        if len(state["conversation_history"]) > 20:
            state["conversation_history"] = state["conversation_history"][-20:]

    def get_conversation_context(self, session_id: str) -> str:
        """Get recent conversation for context."""
        state = self.get_session_state(session_id)
        return "\n".join(state["conversation_history"][-20:])  # Last 20 messages

    async def handle_message(self, session_id: str, websocket: WebSocket, request: dict):
        state = self.get_session_state(session_id)
        user_message = request.get("params", {}).get("message")
        request_id = request.get("requestId")

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
        if state["waiting_for_confirmation"]:
            if "yes" in user_message.lower() or "ok" in user_message.lower() or "sure" in user_message.lower():
                # User confirmed - save the plan
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
                # User declined or wants changes
                state["waiting_for_confirmation"] = False
                response_content = "No problem! What would you like to change about the project plan, or would you like to start over?"
        else:
            # Main conversation handling
            prompt = f"""You are a helpful project planning assistant. Guide users through a natural conversation to gather comprehensive project information before creating detailed plans.

CONVERSATION CONTEXT:
{conversation_context}

USER'S CURRENT MESSAGE: "{user_message}"

THREE-STAGE PLANNING APPROACH:
1. **PROJECT BASICS** - Understand what they want to build, main purpose, target audience
2. **FEATURES & REQUIREMENTS** - Dive into specific functionality, user interactions, key features
3. **TECHNICAL DETAILS** - Discuss platform preferences, complexity, timeline, technology choices

CONVERSATION GUIDELINES:
- Have a natural, friendly conversation
- Ask follow-up questions to understand their vision better
- Guide them through the three stages naturally
- Only suggest creating a plan when you have comprehensive information across all areas or if the user wants you to
- Be curious about their project and ask thoughtful questions
- Help them think through aspects they might not have considered

CURRENT FOCUS:
- If they just shared a basic project idea, ask about target users and main goals
- If you know the basics, explore specific features and functionality they envision
- If you have features, discuss technical preferences and constraints
- Only when all three areas are well-covered, offer to create the detailed plan

Be conversational, ask good questions, and help them develop their project idea fully:"""

            # Generate response
            response = await llm_service.generate(prompt)
            
            # Check if we should generate a project plan
            should_generate_plan = await self._should_generate_plan(session_id, user_message, conversation_context)
            
            if should_generate_plan:
                # Accumulate project information
                if state["project_info"]:
                    state["project_info"] += f" {user_message}"
                else:
                    state["project_info"] = user_message
                
                print(f"[Session: {session_id}] Generating project plan...")
                
                # Generate the project plan
                try:
                    plan_response = await self.recommendations_agent.handle(state["project_info"])
                    
                    # Clean up JSON response
                    if plan_response.strip().startswith("```json"):
                        plan_response = plan_response.strip()[7:-3]
                    elif plan_response.strip().startswith("```"):
                        plan_response = plan_response.strip()[3:-3]
                    
                    plan_data = json.loads(plan_response)
                    state["generated_plan"] = plan_data
                    state["waiting_for_confirmation"] = True
                    
                    # Format plan for display
                    plan_text = json.dumps(plan_data, indent=2)
                    response_content = f"Based on our conversation, I've created a detailed project plan for you:\n\n{plan_text}\n\nWould you like me to save this plan?"
                    
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
        
        # Send response
        response_data = {"content": response_content}
        print(f"[Session: {session_id}] Sending response")
        await websocket.send_json({"event": "response", "data": response_data, "requestId": request_id, "sessionId": session_id})

    async def _should_generate_plan(self, session_id: str, message: str, context: str) -> bool:
        """Determine if we have enough information to generate a project plan."""
        state = self.get_session_state(session_id)
        
        # Don't generate if we just generated one
        if state["waiting_for_confirmation"]:
            return False
        
        # Check if we have comprehensive project information across all three stages
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

        response = await llm_service.generate(prompt)
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
            
            # Route to analytics agent
            analytics_response = await self.analytics_agent.handle(action, data)
            
            # Send response back through WebSocket
            response_data = {
                "event": "analytics_response",
                "sessionId": session_id,
                "requestId": request_id,
                "data": analytics_response
            }
            
            print(f"[Session: {session_id}] Sending analytics response")
            await websocket.send_json(response_data)
            
        except Exception as e:
            error_message = f"Analytics request failed: {str(e)}"
            print(f"[Session: {session_id}] {error_message}")
            
            error_response = {
                "event": "analytics_error",
                "sessionId": session_id,
                "requestId": request.get("requestId"),
                "error": error_message
            }
            await websocket.send_json(error_response)

orchestrator = OrchestratorAgent()