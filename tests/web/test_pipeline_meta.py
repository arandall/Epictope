from web import pipeline, parsing
import web.config as cfg

def test_finalize_meta(tmp_path, monkeypatch):
    monkeypatch.setattr(cfg, "OUTPUTS_DIR", tmp_path)
    d = tmp_path / "Q9W7E7"; d.mkdir()
    (d / "Q9W7E7_score.csv").write_text(
        "position,normalized_entropy,ss_score,rsa,inv_anchor2,sum_score,min,min_feature,aa\n"
        "1,0,1,1,0.6,2.6,0,n_e,M\n2,0.1,1,0.8,0.65,2.55,0.1,n_e,T\n")
    monkeypatch.setattr(pipeline.uniprot, "search",
                        lambda q: [{"accession":"Q9W7E7","gene":"smad5","organism":"Danio rerio","reviewed":True,"hasAlphaFold":True}])
    pipeline.finalize_meta("Q9W7E7", None, None)
    meta = parsing.read_meta("Q9W7E7")
    assert meta["gene"] == "smad5"
    assert meta["top_sites"][0]["position"] == 2
