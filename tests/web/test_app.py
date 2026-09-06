from fastapi.testclient import TestClient
from web import app as app_module

def test_status_shape():
    client = TestClient(app_module.app)
    resp = client.get("/api/status")
    assert resp.status_code == 200
    body = resp.json()
    assert "installed" in body and "progress" in body
    assert isinstance(body["installed"], bool)


def test_install_marker_drives_status(tmp_path, monkeypatch):
    import web.config as cfg
    monkeypatch.setattr(cfg, "INSTALL_MARKER", tmp_path / ".installed")
    monkeypatch.setattr(cfg, "INSTALL_LOG", tmp_path / "install.log")
    from importlib import reload
    import web.app as appmod
    reload(appmod)
    client = TestClient(appmod.app)
    assert client.get("/api/status").json()["installed"] is False
    (tmp_path / ".installed").write_text("")
    assert client.get("/api/status").json()["installed"] is True
