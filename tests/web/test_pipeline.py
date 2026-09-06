import threading
import time
from pathlib import Path
from web import parsing, pipeline

SCORE_CSV = ("position,normalized_entropy,ss_score,rsa,inv_anchor2,sum_score,min,min_feature,aa\n"
             "1,0,1,1,0.6,2.6,0.1,n_e,M\n"
             "2,0.1,1,0.8,0.65,2.55,0.9,n_e,T\n"
             "3,0,1,1,0.6,2.6,0.2,n_e,A\n")

class FakePopen:
    """Minimal Popen stand-in: canned stdout, already-exited returncode."""
    def __init__(self, lines=(), returncode=0):
        import io
        self.stdout = io.StringIO("".join(lines))
        self.returncode = returncode
    def poll(self):
        return self.returncode
    def kill(self):
        self.returncode = -9

def make_fake_popen(uniprot_id="Q9W7E7", lines=("some r output\n",),
                    returncode=0, write_outputs=True):
    captured = {}
    def _fake(cmd, cwd=None, env=None, **kw):
        captured["cmd"], captured["cwd"], captured["env"] = cmd, cwd, env
        if write_outputs:
            out = Path(env["EPICTORE_OUTDIR"])
            (out / f"{uniprot_id}_score.csv").write_text(SCORE_CSV)
            (out / f"{uniprot_id}_msa.fasta").write_text(f">{uniprot_id}\nMA\n")
        return FakePopen(lines=lines, returncode=returncode)
    _fake.captured = captured
    return _fake

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

def test_job_id_deterministic():
    assert pipeline.JobStore.create("Q9W7E7") == pipeline.JobStore.create("Q9W7E7")

def test_enqueue_job_cache_first(tmp_path, monkeypatch):
    import web.config as cfg
    monkeypatch.setattr(cfg, "OUTPUTS_DIR", tmp_path)
    d = tmp_path / "Q9W7E7"; d.mkdir()
    (d / "Q9W7E7_score.csv").write_text(SCORE_CSV)
    monkeypatch.setattr(pipeline.uniprot, "search", lambda q: [])
    monkeypatch.setattr(pipeline.subprocess, "Popen",
                        lambda *a, **k: (_ for _ in ()).throw(AssertionError("must not run")))
    job_id = pipeline.JobStore.create("Q9W7E7")
    pipeline.enqueue_job(job_id, "Q9W7E7")
    assert pipeline.JobStore.get(job_id)["status"] == "done"
    assert parsing.read_meta("Q9W7E7") is not None  # meta (re)written on cache hit

def test_run_job_sets_outdir_and_cwd(tmp_path, monkeypatch):
    import web.config as cfg
    monkeypatch.setattr(cfg, "OUTPUTS_DIR", tmp_path)
    monkeypatch.setattr(cfg, "APP_DIR", tmp_path)
    monkeypatch.setattr(pipeline.uniprot, "search", lambda q: [])
    fake = make_fake_popen()
    monkeypatch.setattr(pipeline.subprocess, "Popen", fake)
    job_id = pipeline.JobStore.create("Q9W7E7")
    pipeline.run_job(job_id, "Q9W7E7")
    assert fake.captured["cwd"] == str(tmp_path)
    assert fake.captured["env"]["EPICTORE_OUTDIR"].endswith("Q9W7E7")
    assert pipeline.JobStore.get(job_id)["status"] == "done"
    assert (tmp_path / "Q9W7E7" / "run.log").exists()
    assert parsing.read_meta("Q9W7E7") is not None  # meta written on run success

def test_run_job_custom_structure_sidecar(tmp_path, monkeypatch):
    import web.config as cfg
    monkeypatch.setattr(cfg, "OUTPUTS_DIR", tmp_path)
    monkeypatch.setattr(cfg, "APP_DIR", tmp_path)
    monkeypatch.setattr(pipeline.uniprot, "search", lambda q: [])
    monkeypatch.setattr(pipeline.subprocess, "Popen", make_fake_popen())
    job_id = pipeline.JobStore.create("Q9W7E7", custom_structure="/x/m.cif")
    pipeline.run_job(job_id, "Q9W7E7", custom_structure="/x/m.cif")
    sidecar = tmp_path / "Q9W7E7" / "custom_structure.txt"
    assert sidecar.exists() and sidecar.read_text() == "/x/m.cif"
    assert pipeline.JobStore.get(job_id)["status"] == "done"

def test_run_job_error_path(tmp_path, monkeypatch):
    import web.config as cfg
    monkeypatch.setattr(cfg, "OUTPUTS_DIR", tmp_path)
    monkeypatch.setattr(cfg, "APP_DIR", tmp_path)
    fake = make_fake_popen(lines=("boom: something failed\n",), returncode=1)
    monkeypatch.setattr(pipeline.subprocess, "Popen", fake)
    job_id = pipeline.JobStore.create("Q9W7E7")
    pipeline.run_job(job_id, "Q9W7E7")
    state = pipeline.JobStore.get(job_id)
    assert state["status"] == "error" and "boom" in state["error"]

def test_run_job_errors_when_outputs_missing(tmp_path, monkeypatch):
    import web.config as cfg
    monkeypatch.setattr(cfg, "OUTPUTS_DIR", tmp_path)
    monkeypatch.setattr(cfg, "APP_DIR", tmp_path)
    fake = make_fake_popen(returncode=0, write_outputs=False)  # exit 0, no files
    monkeypatch.setattr(pipeline.subprocess, "Popen", fake)
    job_id = pipeline.JobStore.create("Q9W7E7")
    pipeline.run_job(job_id, "Q9W7E7")
    state = pipeline.JobStore.get(job_id)
    assert state["status"] == "error" and "did not produce" in state["error"]

def test_ensure_meta_writes_json_with_peak_top_sites(tmp_path, monkeypatch):
    import web.config as cfg
    monkeypatch.setattr(cfg, "OUTPUTS_DIR", tmp_path)
    d = tmp_path / "Q9W7E7"; d.mkdir()
    (d / "Q9W7E7_score.csv").write_text(SCORE_CSV)
    monkeypatch.setattr(pipeline.uniprot, "search", lambda q: [
        {"accession": "Q9W7E7", "gene": "smad5", "organism": "Danio rerio",
         "reviewed": True, "hasAlphaFold": True}])
    pipeline.ensure_meta("Q9W7E7")
    meta = parsing.read_meta("Q9W7E7")
    assert meta["gene"] == "smad5" and meta["length"] == 3
    assert meta["top_sites"][0]["position"] == 2  # the 0.9 peak

def test_ensure_meta_survives_uniprot_failure(tmp_path, monkeypatch):
    import urllib.error
    import web.config as cfg
    monkeypatch.setattr(cfg, "OUTPUTS_DIR", tmp_path)
    d = tmp_path / "Q9W7E7"; d.mkdir()
    (d / "Q9W7E7_score.csv").write_text("position,min,aa\n1,0.5,M\n")
    def boom(q): raise urllib.error.URLError("offline")
    monkeypatch.setattr(pipeline.uniprot, "search", boom)
    pipeline.ensure_meta("Q9W7E7")
    meta = parsing.read_meta("Q9W7E7")
    assert meta["uniprot_id"] == "Q9W7E7" and meta["gene"] == ""

def test_jobs_run_one_at_a_time(tmp_path, monkeypatch):
    import web.config as cfg
    monkeypatch.setattr(cfg, "OUTPUTS_DIR", tmp_path)
    monkeypatch.setattr(pipeline, "result_exists", lambda *a, **k: False)
    started = threading.Event(); release = threading.Event(); running = []
    def fake_run_job(job_id, uid, custom_structure=None, n_terminal=None):
        running.append(job_id)
        started.set()
        release.wait(5)
        running.remove(job_id)
        pipeline.JobStore.set_status(job_id, "done")
    monkeypatch.setattr(pipeline, "run_job", fake_run_job)
    j1 = pipeline.JobStore.create("AAA")
    pipeline.enqueue_job(j1, "AAA")
    assert started.wait(5)
    j2 = pipeline.JobStore.create("BBB")
    pipeline.enqueue_job(j2, "BBB")
    time.sleep(0.3)
    assert running == [j1]                                    # second job not started
    assert pipeline.JobStore.get(j2)["status"] == "queued"
    # re-submitting the in-flight job must not clobber or duplicate it
    assert pipeline.JobStore.create("AAA") == j1
    pipeline.enqueue_job(j1, "AAA")
    assert pipeline.JobStore.get(j1)["status"] == "running"
    release.set()
    for _ in range(50):
        if pipeline.JobStore.get(j2)["status"] == "done":
            break
        time.sleep(0.1)
    assert pipeline.JobStore.get(j2)["status"] == "done"