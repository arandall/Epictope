from fastapi.testclient import TestClient
from web import app as app_module
from web import pipeline

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

def test_run_endpoint_accepts_multipart(tmp_path, monkeypatch):
    import web.config as cfg
    monkeypatch.setattr(cfg, "OUTPUTS_DIR", tmp_path)
    monkeypatch.setattr(cfg, "INSTALL_MARKER", tmp_path / ".installed")
    (tmp_path / ".installed").write_text("")
    monkeypatch.setattr(pipeline, "result_exists", lambda *a, **k: True)
    monkeypatch.setattr(pipeline, "ensure_meta", lambda *a, **k: None)
    client = TestClient(app_module.app)
    resp = client.post("/api/run", data={"uniprot_id": "Q9W7E7"})
    assert resp.status_code == 200
    assert resp.json()["job_id"].startswith("Q9W7E7-")

def test_run_endpoint_gated_on_install_marker(tmp_path, monkeypatch):
    import web.config as cfg
    monkeypatch.setattr(cfg, "OUTPUTS_DIR", tmp_path)
    monkeypatch.setattr(cfg, "INSTALL_MARKER", tmp_path / ".installed")
    monkeypatch.setattr(pipeline, "result_exists", lambda *a, **k: True)
    monkeypatch.setattr(pipeline, "ensure_meta", lambda *a, **k: None)
    client = TestClient(app_module.app)
    resp = client.post("/api/run", data={"uniprot_id": "Q9W7E7"})
    assert resp.status_code == 503
    assert "downloading" in resp.json()["detail"].lower()
    (tmp_path / ".installed").write_text("")
    resp = client.post("/api/run", data={"uniprot_id": "Q9W7E7"})
    assert resp.status_code == 200

def test_run_endpoint_runs_off_event_loop():
    import inspect
    for route in app_module.app.routes:
        if getattr(route, "path", None) == "/api/run" and "POST" in route.methods:
            assert not inspect.iscoroutinefunction(route.endpoint)
            return
    raise AssertionError("POST /api/run route not found")

def test_results_404_for_unknown_id():
    client = TestClient(app_module.app)
    assert client.get("/api/results/NOPE/score").status_code == 404
    assert client.get("/api/results/NOPE/msa").status_code == 404
    assert client.get("/api/results/NOPE/info").status_code == 404

def test_unknown_job_404():
    client = TestClient(app_module.app)
    assert client.get("/api/jobs/NOPE").status_code == 404