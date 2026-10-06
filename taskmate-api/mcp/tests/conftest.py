import os
import sys

# Must happen before llm_service/server are imported: the tests never use real secrets or reach Groq.
os.environ["GROQ_API_KEY"] = "gsk_test_dummy_key_not_real"
os.environ.pop("LLM_API_KEY", None)
TEST_SHARED_SECRET = "3f9c1a7e5b2d4c6e8a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f"
os.environ["MCP_SHARED_SECRET"] = TEST_SHARED_SECRET
os.environ.pop("MCP_ALLOW_NO_SECRET", None)
AUTH_HEADERS = {"X-MCP-Secret": TEST_SHARED_SECRET}

MCP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if MCP_DIR not in sys.path:
    sys.path.insert(0, MCP_DIR)

import pytest  # noqa: E402

import llm_service  # noqa: E402


class _NoNetworkClient:
    def with_options(self, **_kwargs):
        return self

    @property
    def chat(self):
        raise AssertionError("A real Groq call was attempted during tests")


@pytest.fixture(autouse=True)
def block_real_llm(monkeypatch):
    monkeypatch.setattr(llm_service, "_client", _NoNetworkClient())


class FakeSocket:
    """Collects replies the way server.Connection would send them."""

    def __init__(self):
        self.sent = []

    async def send_json(self, message):
        self.sent.append(message)


@pytest.fixture
def fake_socket():
    return FakeSocket()
