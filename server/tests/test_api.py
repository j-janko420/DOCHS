import os
os.environ["APP_ENV"] = "test"
os.environ["DORCHS_API_TOKEN"] = "test-token-which-is-long-enough-for-tests"
os.environ["TRUSTED_HOSTS"] = "testserver,localhost"

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
