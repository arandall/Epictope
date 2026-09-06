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
