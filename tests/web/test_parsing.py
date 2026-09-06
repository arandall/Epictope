from web import parsing

SCORE = ("position,normalized_entropy,ss_score,rsa,inv_anchor2,sum_score,min,min_feature,aa\n"
         "1,0,1,1.2,0.6,2.8,0,normalized_entropy,M\n"
         "2,0.1,1,0.8,0.65,2.7,0.1,normalized_entropy,T\n")

def test_parse_score_csv(tmp_path):
    p = tmp_path / "Q9W7E7_score.csv"; p.write_text(SCORE)
    rows = parsing.parse_score_csv(p)
    assert rows[0]["position"] == 1 and rows[0]["aa"] == "M"
    assert rows[1]["min"] == 0.1                  # coerced to float, not str
    assert rows[0]["normalized_entropy"] == 0

def test_parse_score_csv_na_becomes_none(tmp_path):
    p = tmp_path / "X_score.csv"
    p.write_text("position,min,aa,phi\n1,NA,M,NA\n")
    rows = parsing.parse_score_csv(p)
    assert rows[0]["min"] is None and rows[0]["phi"] is None

def test_compute_top_sites_detects_distinct_peaks():
    rows = [{"position": i + 1, "min": m, "min_feature": "x"}
            for i, m in enumerate([0.1, 0.9, 0.8, 0.2, 0.85, 0.7])]
    top = parsing.compute_top_sites(rows, n=2)
    assert [t["position"] for t in top] == [2, 5]  # two peaks, not residues 2 and 3

def test_parse_msa(tmp_path):
    p = tmp_path / "Q9W7E7_msa.fasta"; p.write_text(">Q9W7E7\nACGT\n>other\nAC-T\n")
    msa = parsing.parse_msa(p)
    assert msa["records"][0]["seq"] == "ACGT"
    assert msa["query"] == "Q9W7E7"

def test_meta_roundtrip(tmp_path, monkeypatch):
    import web.config as cfg
    monkeypatch.setattr(cfg, "OUTPUTS_DIR", tmp_path)
    parsing.write_meta("Q9W7E7", gene="smad5", organism="Danio rerio")
    meta = parsing.read_meta("Q9W7E7")
    assert meta["gene"] == "smad5"