import os
os.environ["APP_ENV"] = "test"
os.environ["DORCHS_API_TOKEN"] = "test-token-which-is-long-enough-for-tests"
os.environ["TRUSTED_HOSTS"] = "testserver,localhost"
os.environ["ALLOWED_ORIGINS"] = "http://localhost:5173"

from fastapi.testclient import TestClient
from app.main import app

def auth():
    return {"Authorization": "Bearer test-token-which-is-long-enough-for-tests"}

def test_live_health():
    with TestClient(app) as client:
        response = client.get("/health/live")
        assert response.status_code == 200
        assert response.json()["status"] == "alive"

def test_ready_health():
    with TestClient(app) as client:
        response = client.get("/health/ready")
        assert response.status_code == 200
        assert response.json()["status"] in {"ready", "starting"}

def test_provider_list_requires_auth():
    with TestClient(app) as client:
        assert client.get("/v1/providers").status_code == 401

def test_provider_list_does_not_expose_keys():
    with TestClient(app) as client:
        response = client.get("/v1/providers", headers=auth())
        assert response.status_code == 200
        body = response.json()
        assert {p["id"] for p in body["providers"]} == {"anthropic", "xai", "openai_compatible"}
        assert all("api_key" not in p for p in body["providers"])

def test_invalid_provider_rejected_by_schema():
    with TestClient(app) as client:
        response = client.post("/v1/ai/chat", headers=auth(), json={
            "provider": "made_up", "messages": [{"role": "user", "content": "hi"}]
        })
        assert response.status_code == 422

def test_chat_rejects_missing_auth():
    with TestClient(app) as client:
        response = client.post("/v1/ai/chat", json={
            "provider": "xai", "messages": [{"role": "user", "content": "hello"}]
        })
        assert response.status_code == 401


from app.providers import ProviderResult


def test_cors_allows_only_listed_origins():
    with TestClient(app) as client:
        ok = client.options("/v1/providers", headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "authorization"})
        assert ok.headers.get("access-control-allow-origin") == "http://localhost:5173"
        bad = client.options("/v1/providers", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "GET"})
        assert "access-control-allow-origin" not in bad.headers


def test_suggest_mapping_requires_auth():
    with TestClient(app) as client:
        assert client.post("/v1/dochs/suggest-mapping", json={"provider": "anthropic", "headers": ["Door No"]}).status_code == 401


def test_suggest_mapping_validates_the_ai_answer(monkeypatch):
    with TestClient(app) as client:
        async def fake_chat(request):
            assert request.messages[0].role == "system"
            return ProviderResult("anthropic", "claude-opus-5-5", '{"mapping": ["mark", "nonsense", "fireRating"]}', {})
        monkeypatch.setattr(client.app.state.providers, "chat", fake_chat)
        response = client.post("/v1/dochs/suggest-mapping", headers=auth(), json={
            "provider": "anthropic", "headers": ["Door No", "Zone", "FR"], "samples": [["D-1", "T", "1 HR"]]})
        assert response.status_code == 200
        body = response.json()
        assert body["mapping"] == ["mark", "", "fireRating"]
        assert any("unknown field" in n for n in body["notes"])


def test_suggest_mapping_bounds_input():
    with TestClient(app) as client:
        response = client.post("/v1/dochs/suggest-mapping", headers=auth(), json={"provider": "anthropic", "headers": ["x" * 201]})
        assert response.status_code == 422
