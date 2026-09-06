from web import pipeline


def test_result_exists_true(tmp_path, monkeypatch):
    import web.config as cfg
    monkeypatch.setattr(cfg, "OUTPUTS_DIR", tmp_path)
    (tmp_path / "Q9W7E7").mkdir()
    (tmp_path / "Q9W7E7" / "Q9W7E7_score.csv").write_text("position,min\n1,0\n")
    assert pipeline.result_exists("Q9W7E7") is True


def test_result_exists_false(tmp_path, monkeypatch):
    import web.config as cfg
    monkeypatch.setattr(cfg, "OUTPUTS_DIR", tmp_path)
    assert pipeline.result_exists("Q9W7E7") is False


def test_build_command_basic():
    cmd = pipeline.build_command("Q9W7E7")
    assert cmd[0].endswith("Rscript") and "Q9W7E7" in cmd


def test_build_command_custom():
    cmd = pipeline.build_command("Q9W7E7", custom_structure="/x/m.cif", n_terminal=57)
    assert "/x/m.cif" in cmd and "57" in cmd


def test_enqueue_job_cache_first(tmp_path, monkeypatch):
    import web.config as cfg
    monkeypatch.setattr(cfg, "OUTPUTS_DIR", tmp_path)
    monkeypatch.setattr(pipeline, "result_exists", lambda *a, **k: True)
    ran = {"subprocess": False}
    orig_run = pipeline.subprocess.run
    monkeypatch.setattr(pipeline.subprocess, "run", lambda *a, **k: ran.__setitem__("subprocess", True) or orig_run(*a, **k))
    job_id = pipeline.JobStore.create("Q9W7E7")
    pipeline.enqueue_job(job_id, "Q9W7E7")
    assert pipeline.JobStore.get(job_id)["status"] == "done"
    assert ran["subprocess"] is False


def test_run_job_sets_outdir_and_cwd(tmp_path, monkeypatch):
    import web.config as cfg
    monkeypatch.setattr(cfg, "OUTPUTS_DIR", tmp_path)
    monkeypatch.setattr(cfg, "APP_DIR", tmp_path)

    captured = {}

    class FakeProc:
        returncode = 0
        stderr = ""

    def fake_run(*args, **kwargs):
        captured["args"] = args
        captured["cwd"] = kwargs.get("cwd")
        captured["env"] = kwargs.get("env")
        return FakeProc()

    monkeypatch.setattr(pipeline.subprocess, "run", fake_run)

    job_id = pipeline.JobStore.create("Q9W7E7")
    pipeline.run_job(job_id, "Q9W7E7")

    assert captured["cwd"] == str(tmp_path)
    assert captured["env"]["EPICTORE_OUTDIR"].endswith("Q9W7E7")
    assert pipeline.JobStore.get(job_id)["status"] == "done"


def test_run_job_custom_structure_sidecar(tmp_path, monkeypatch):
    import web.config as cfg
    monkeypatch.setattr(cfg, "OUTPUTS_DIR", tmp_path)
    monkeypatch.setattr(cfg, "APP_DIR", tmp_path)

    class FakeProc:
        returncode = 0
        stderr = ""

    monkeypatch.setattr(pipeline.subprocess, "run", lambda *a, **k: FakeProc())

    job_id = pipeline.JobStore.create("Q9W7E7", custom_structure="/x/m.cif")
    pipeline.run_job(job_id, "Q9W7E7", custom_structure="/x/m.cif")

    sidecar = tmp_path / "Q9W7E7" / "custom_structure.txt"
    assert sidecar.exists()
    assert sidecar.read_text() == "/x/m.cif"
    assert pipeline.JobStore.get(job_id)["status"] == "done"


def test_run_job_error_path(tmp_path, monkeypatch):
    import web.config as cfg
    monkeypatch.setattr(cfg, "OUTPUTS_DIR", tmp_path)
    monkeypatch.setattr(cfg, "APP_DIR", tmp_path)

    class FakeProc:
        returncode = 1
        stderr = "boom: something failed"

    monkeypatch.setattr(pipeline.subprocess, "run", lambda *a, **k: FakeProc())

    job_id = pipeline.JobStore.create("Q9W7E7")
    pipeline.run_job(job_id, "Q9W7E7")

    state = pipeline.JobStore.get(job_id)
    assert state["status"] == "error"
    assert "boom" in state["error"]


def test_jobstore_transitions(tmp_path, monkeypatch):
    import web.config as cfg
    monkeypatch.setattr(cfg, "OUTPUTS_DIR", tmp_path)
    job_id = pipeline.JobStore.create("Q9W7E7")
    assert pipeline.JobStore.get(job_id)["status"] == "queued"
    pipeline.JobStore.set_status(job_id, "running")
    assert pipeline.JobStore.get(job_id)["status"] == "running"
    pipeline.JobStore.set_status(job_id, "done")
    assert pipeline.JobStore.get(job_id)["status"] == "done"
