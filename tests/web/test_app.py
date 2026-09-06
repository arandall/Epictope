from fastapi.testclient import TestClient
from web import app as app_module

def test_status_shape():
    client = TestClient(app_module.app)
    resp = client.get("/api/status")
    assert resp.status_code == 200
    body = resp.json()
    assert "installed" in body and "progress" in body
    assert isinstance(body["installed"], bool)
