import os
import sys

# Must happen before llm_service is imported: the tests never use a real key or reach Groq.
os.environ["GROQ_API_KEY"] = "gsk_test_dummy_key_not_real"
os.environ.pop("LLM_API_KEY", None)

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
