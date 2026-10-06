from datetime import datetime, timedelta, timezone

import pytest

import llm_service
from agents.analytics_agent import AnalyticsAgent

TEAM_CONTEXT = {"team_members": [
    {"uid": "u-ana", "username": "ana", "current_workload": 1, "historical_capacity": 5,
     "expertise_by_category": {"backend": {"expertise_score": 90, "success_rate_percentage": 95}}},
    {"uid": "u-beto", "username": "beto", "current_workload": "4", "historical_capacity": "4",
     "expertise_by_category": {"backend": {"expertise_score": 20, "success_rate_percentage": 40},
                               "unknown": {"expertise_score": 99}}},
]}


@pytest.fixture(autouse=True)
def llm_unavailable(monkeypatch):
    async def unavailable(*_args, **_kwargs):
        raise llm_service.LLMError("down")

    monkeypatch.setattr(llm_service, "generate_json", unavailable)


async def test_recommendations_use_team_context():
    result = await AnalyticsAgent().handle("get_task_assignment_recommendations", {
        "group_id": "real-group", "task_category": "backend", "team_context": TEAM_CONTEXT})
    assert result["success"] and result["data_source"] == "real"
    assert [rec["username"] for rec in result["recommendations"]] == ["ana", "beto"]
    assert result["recommendations"][0]["metrics"]["data_source"] == "real"
    assert result["suggested_plan"]["fallback_used"] is True


async def test_llm_enhancement_is_used_when_valid(monkeypatch):
    async def enhanced(prompt, **_kwargs):
        assert "JSON" in prompt
        return {"recommendations": [{"username": "ana", "adjusted_score": 10, "confidence_level": "low",
                                     "reasoning": "r"}, "garbage"],
                "suggested_plan": {"primary_assignee": "beto", "plan_type": "solo", "rationale": "x"}}

    monkeypatch.setattr(llm_service, "generate_json", enhanced)
    result = await AnalyticsAgent().handle("get_task_assignment_recommendations", {
        "group_id": "real-group", "task_category": "backend", "team_context": TEAM_CONTEXT})
    ana = next(rec for rec in result["recommendations"] if rec["username"] == "ana")
    assert result["recommendations"][0]["username"] == "beto"
    assert ana["score"] == 10 and ana["confidence_level"] == "low"
    assert result["suggested_plan"]["primary_assignee"] == "beto"


async def test_team_views_use_team_context():
    agent = AnalyticsAgent()
    data = {"group_id": "real-group", "team_context": TEAM_CONTEXT}
    team = await agent.handle("get_team_analytics", data)
    assert team["data_source"] == "real" and [m["username"] for m in team["team_analytics"]] == ["ana", "beto"]
    assert set(team["team_analytics"][1]["expertise_by_category"]) == {"backend"}

    workload = await agent.handle("get_workload_distribution", data)
    assert workload["workload_distribution"][0] == {
        "user_id": "u-beto", "username": "beto", "current_workload": 4, "capacity": 4,
        "utilization_percentage": 100.0, "status": "overloaded"}

    rankings = await agent.handle("get_expertise_rankings", {**data, "category": "backend"})
    assert [r["username"] for r in rankings["rankings"]] == ["ana", "beto"]


async def test_demo_groups_keep_mock_data():
    result = await AnalyticsAgent().handle("get_team_analytics", {"group_id": "test-group-456"})
    assert result["data_source"] == "mock" and len(result["team_analytics"]) == 8
    assert result["team_analytics"][0]["username"] == "Sarah Chen"


@pytest.mark.parametrize("action, empty_key", [
    ("get_task_assignment_recommendations", "recommendations"),
    ("get_team_analytics", "team_analytics"),
    ("get_workload_distribution", "workload_distribution"),
])
async def test_unknown_group_without_context_invents_nobody(action, empty_key):
    result = await AnalyticsAgent().handle(action, {"group_id": "0b7e2c1a-real-but-no-context"})
    assert result["success"] and result["no_data"] and result["data_source"] == "none"
    assert result[empty_key] == []
    assert "Sarah Chen" not in str(result)


async def test_expertise_rankings_without_data():
    result = await AnalyticsAgent().handle("get_expertise_rankings", {"group_id": "other"})
    assert result["no_data"] and all(value == [] for value in result["expertise_rankings"].values())


async def test_empty_team_context_is_no_data_even_for_demo_ids():
    result = await AnalyticsAgent().handle("get_team_analytics",
                                           {"group_id": "test-group-456", "team_context": {"team_members": []}})
    assert result["no_data"] and result["team_analytics"] == []


async def test_user_analytics_sources_and_current_timestamp():
    agent = AnalyticsAgent()
    real = await agent.handle("get_user_analytics", {"user_id": "u-ana", "team_context": TEAM_CONTEXT})
    assert real["analytics"]["data_source"] == "real" and real["analytics"]["current_workload"] == 1
    updated = datetime.strptime(real["analytics"]["updated_at"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    assert abs(datetime.now(timezone.utc) - updated) < timedelta(minutes=1)

    demo = await agent.handle("get_user_analytics", {"user_id": "dev_user1"})
    assert demo["analytics"]["data_source"] == "mock"

    unknown = await agent.handle("get_user_analytics", {"user_id": "someone-real"})
    assert unknown["analytics"] is None and unknown["no_data"]


def test_dead_node_bridge_is_gone():
    agent = AnalyticsAgent()
    assert not hasattr(agent, "_call_node_service") and not hasattr(agent, "use_real_analytics")
