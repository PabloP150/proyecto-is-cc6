import pytest

import llm_service
from agents import orchestrator as orchestrator_module
from agents.orchestrator import (CHANGE, CONFIRM, DISCARD, PROJECT_INFO_MAX_CHARS, REJECT, OrchestratorAgent,
                                 classify_confirmation)

PLAN = {"recommendations": {
    "project_name": "Dog Walker",
    "technology_stack": {"frontend": ["React"], "backend": ["Node"], "database": ["SQL Server"]},
    "roles": [{"name": "Dev", "icon": "code"}],
    "milestones": [{"id": "m1", "name": "Setup", "date": "2030-01-01", "description": "Start"}],
    "tasks": [{"name": "Repo", "milestone_id": "m1"}, {"name": "CI", "milestone_id": "m1"}],
}}


@pytest.mark.parametrize("message", ["design", "diseño", "No, cambia el diseño", "yes but change the colors",
                                     "Si quieres cambia el nombre", "okey dokey maybe", "sin cambios? no se"])
def test_messages_that_are_not_confirmations(message):
    assert classify_confirmation(message) != CONFIRM


@pytest.mark.parametrize("message", ["sí, dale", "Sí", "yes", "OK!", "guárdalo por favor", "Save the plan", "de acuerdo"])
def test_confirmations(message):
    assert classify_confirmation(message) == CONFIRM


def test_rejection_kinds():
    assert classify_confirmation("no") == REJECT
    assert classify_confirmation("No, gracias") == REJECT
    assert classify_confirmation("mejor empezar de nuevo") == DISCARD
    assert classify_confirmation("no, cambia el diseño a azul") == CHANGE


@pytest.fixture
def llm(monkeypatch):
    calls = {"generate": [], "json": []}

    async def fake_generate(prompt, generation_config_override=None, max_tokens=None, timeout=None):
        calls["generate"].append(prompt)
        return "NO" if "Respond with ONLY: YES or NO" in prompt else "Tell me more about your project."

    async def fake_generate_json(messages, **kwargs):
        calls["json"].append(messages)
        return PLAN

    monkeypatch.setattr(llm_service, "generate", fake_generate)
    monkeypatch.setattr(llm_service, "generate_json", fake_generate_json)
    return calls


def request(text, request_id="r"):
    return {"requestId": request_id, "sessionId": "S", "method": "handle_user_message",
            "params": {"message": text, "context": {"userId": "u1"}}}


async def test_user_message_flow_regression(llm, fake_socket):
    agent = OrchestratorAgent()
    await agent.handle_message("S", fake_socket, request("I want to build an app for dog walkers", "r1"))
    reply = fake_socket.sent[-1]
    assert reply == {"event": "response", "data": {"content": "Tell me more about your project."},
                     "requestId": "r1", "sessionId": "S"}
    assert agent.sessions["S"]["project_info"] == "I want to build an app for dog walkers"

    await agent.handle_message("S", fake_socket, request("generate the plan", "r2"))
    reply = fake_socket.sent[-1]
    assert reply["event"] == "response" and reply["requestId"] == "r2"
    assert "Project Plan Ready: **Dog Walker**" in reply["data"]["content"]
    assert "**2** tasks" in reply["data"]["content"]
    assert reply["data"]["awaiting_confirmation"] is True
    state = agent.sessions["S"]
    assert state["waiting_for_confirmation"] and state["generated_plan"] == PLAN
    # An explicit trigger skips both the "enough info?" check and the chat call.
    assert len(llm["generate"]) == 2 and len(llm["json"]) == 1

    await agent.handle_message("S", fake_socket, request("sí, dale", "r3"))
    reply = fake_socket.sent[-1]
    assert reply == {"event": "save_plan", "sessionId": "S", "requestId": "r3",
                     "data": {"plan": PLAN, "original_message": "I want to build an app for dog walkers generate the plan"}}


def save_result(success, **extra):
    return {"requestId": "n1", "sessionId": "S", "method": "save_plan_result", "params": {"success": success, **extra}}


async def confirmed_agent(fake_socket, **kwargs):
    agent = OrchestratorAgent(**kwargs)
    await agent.handle_message("S", fake_socket, request("create the plan for a todo app"))
    await agent.handle_message("S", fake_socket, request("yes", "confirm"))
    assert fake_socket.sent[-1]["event"] == "save_plan" and fake_socket.sent[-1]["requestId"] == "confirm"
    return agent


async def test_confirmation_waits_for_save_result_before_recording(llm, fake_socket):
    agent = await confirmed_agent(fake_socket)
    state = agent.sessions["S"]
    assert state["pending_save"]["plan"] == PLAN
    assert state["waiting_for_confirmation"] is False
    assert not any("saved" in line for line in state["conversation_history"])


async def test_state_is_cleared_after_successful_save(llm, fake_socket):
    agent = await confirmed_agent(fake_socket)
    sent_before = len(fake_socket.sent)
    await agent.handle_message("S", fake_socket, save_result(True, groupId="g-1", groupName="Dog Walker"))
    assert len(fake_socket.sent) == sent_before  # notification: no reply
    state = agent.sessions["S"]
    assert state["project_info"] == "" and state["generated_plan"] is None and state["pending_save"] is None
    assert state["waiting_for_confirmation"] is False
    assert state["conversation_history"] == ['Assistant: The project plan was saved to the workspace as "Dog Walker".']

    await agent.handle_message("S", fake_socket, request("yes"))
    assert fake_socket.sent[-1]["event"] == "response"


async def test_failed_save_restores_the_plan_for_a_retry(llm, fake_socket):
    agent = await confirmed_agent(fake_socket)
    await agent.handle_message("S", fake_socket, save_result(False, errorCode="SAVE_FAILED"))
    state = agent.sessions["S"]
    assert state["waiting_for_confirmation"] is True and state["generated_plan"] == PLAN
    assert state["pending_save"] is None and "todo app" in state["project_info"]

    await agent.handle_message("S", fake_socket, request("sí", "retry"))
    reply = fake_socket.sent[-1]
    assert (reply["event"], reply["requestId"]) == ("save_plan", "retry") and reply["data"]["plan"] == PLAN


async def test_messages_during_a_pending_save_do_not_trigger_another_save(llm, fake_socket):
    agent = await confirmed_agent(fake_socket)
    await agent.handle_message("S", fake_socket, request("yes", "again"))
    reply = fake_socket.sent[-1]
    assert reply["event"] == "response" and "still saving" in reply["data"]["content"]
    assert agent.sessions["S"]["pending_save"] is not None


async def test_missing_save_result_expires_and_the_plan_can_be_retried(llm, fake_socket):
    agent = await confirmed_agent(fake_socket, pending_save_ttl_sec=0)
    await agent.handle_message("S", fake_socket, request("hello?", "late"))
    reply = fake_socket.sent[-1]
    assert reply["event"] == "response" and reply["requestId"] == "late"
    assert reply["data"]["awaiting_confirmation"] is True and "couldn't confirm" in reply["data"]["content"]
    assert agent.sessions["S"]["generated_plan"] == PLAN

    await agent.handle_message("S", fake_socket, request("yes", "retry"))
    assert fake_socket.sent[-1]["event"] == "save_plan"


async def test_save_result_without_pending_save_is_ignored(llm, fake_socket):
    agent = OrchestratorAgent()
    await agent.handle_message("S", fake_socket, save_result(True))
    assert fake_socket.sent == [] and "S" not in agent.sessions


async def test_session_cap_evicts_the_least_recently_used(llm, fake_socket):
    agent = OrchestratorAgent(max_sessions=3)
    for session_id in ("s1", "s2", "s3"):
        agent.get_session_state(session_id)
    agent.get_session_state("s1")  # s2 becomes the least recently used
    agent.get_session_state("s4")
    assert list(agent.sessions) == ["s3", "s1", "s4"]


async def test_project_info_growth_is_capped(llm, fake_socket):
    agent = OrchestratorAgent()
    await agent.handle_message("S", fake_socket, request("ORIGINAL IDEA: an app " + "a" * 3000))
    for index in range(5):
        await agent.handle_message("S", fake_socket, request(f"feature {index} for the app " + "b" * 3000))
    await agent.handle_message("S", fake_socket, request("LATEST: users want dark mode in the app"))
    info = agent.sessions["S"]["project_info"]
    assert len(info) <= PROJECT_INFO_MAX_CHARS + 5
    assert info.startswith("ORIGINAL IDEA") and info.endswith("dark mode in the app")


async def test_too_long_message_is_rejected_with_code(llm, fake_socket):
    agent = OrchestratorAgent()
    await agent.handle_message("S", fake_socket, request("x" * 4001, "big"))
    assert fake_socket.sent[-1] == {"event": "error", "sessionId": "S", "requestId": "big",
                                    "error": "The message is too long (maximum 4000 characters).",
                                    "code": "MESSAGE_TOO_LONG"}
    assert not llm["generate"]


async def test_diseno_while_waiting_is_not_a_confirmation(llm, fake_socket):
    agent = OrchestratorAgent()
    await agent.handle_message("S", fake_socket, request("create the plan for a todo app"))
    await agent.handle_message("S", fake_socket, request("me gustaría otro diseño"))
    assert fake_socket.sent[-1]["event"] == "response"
    state = agent.sessions["S"]
    assert state["generated_plan"] is None and state["waiting_for_confirmation"] is False
    assert "todo app" in state["project_info"]


async def test_bare_rejection_and_discard(llm, fake_socket):
    agent = OrchestratorAgent()
    await agent.handle_message("S", fake_socket, request("create the plan for a todo app"))
    await agent.handle_message("S", fake_socket, request("no"))
    assert "What would you like to change" in fake_socket.sent[-1]["data"]["content"]
    assert agent.sessions["S"]["generated_plan"] is None
    assert "todo app" in agent.sessions["S"]["project_info"]

    await agent.handle_message("S", fake_socket, request("create the plan"))
    await agent.handle_message("S", fake_socket, request("start over"))
    state = agent.sessions["S"]
    assert state["project_info"] == "" and state["generated_plan"] is None and state["conversation_history"] == [
        "Assistant: No problem! I discarded that plan. What would you like to build?"]


async def test_trigger_phrases_match_whole_words_only(llm, fake_socket):
    agent = OrchestratorAgent()
    await agent.handle_message("S", fake_socket, request("we need to create items and procedemos luego"))
    assert not llm["json"]
    assert agent.sessions["S"]["waiting_for_confirmation"] is False


async def test_invalid_plan_json_gives_the_existing_friendly_message(llm, fake_socket, monkeypatch):
    async def invalid(*_args, **_kwargs):
        raise llm_service.LLMInvalidOutputError("bad")

    monkeypatch.setattr(llm_service, "generate_json", invalid)
    agent = OrchestratorAgent()
    await agent.handle_message("S", fake_socket, request("generate the plan for a chat app"))
    assert fake_socket.sent[-1]["data"]["content"].startswith("I had trouble generating the project plan")
    assert agent.sessions["S"]["waiting_for_confirmation"] is False


async def test_plan_without_task_list_is_rejected(llm, fake_socket, monkeypatch):
    async def no_tasks(*_args, **_kwargs):
        return {"recommendations": {"project_name": "X", "tasks": "none"}}

    monkeypatch.setattr(llm_service, "generate_json", no_tasks)
    agent = OrchestratorAgent()
    await agent.handle_message("S", fake_socket, request("generate the plan"))
    assert fake_socket.sent[-1]["data"]["content"].startswith("I had trouble generating the project plan")


async def test_timeout_is_reported_with_code(llm, fake_socket, monkeypatch):
    async def slow(*_args, **_kwargs):
        raise llm_service.LLMTimeoutError("timeout")

    monkeypatch.setattr(llm_service, "generate", slow)
    agent = OrchestratorAgent()
    await agent.handle_message("S", fake_socket, request("hello"))
    reply = fake_socket.sent[-1]
    assert reply["data"]["error"] == {"code": "LLM_TIMEOUT"}
    assert "took too long" in reply["data"]["content"]


def test_default_ttl_is_two_hours():
    assert orchestrator_module.SESSION_TTL_SEC == 7200
