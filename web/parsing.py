import csv
import json
from pathlib import Path
from web import config

def parse_score_csv(path) -> list[dict]:
    path = Path(path)
    out = []
    with path.open() as fh:
        for r in csv.DictReader(fh):
            d = dict(r)
            if "position" in d:
                d["position"] = int(d["position"])
            out.append(d)
    return out

def parse_msa(path) -> dict:
    path = Path(path)
    records, current_id, seqs = [], None, []
    for line in path.read_text().splitlines():
        if line.startswith(">"):
            if current_id is not None:
                records.append({"id": current_id, "seq": "".join(seqs)})
            current_id = line[1:].split()[0]
            seqs = []
        elif line.strip():
            seqs.append(line.strip())
    if current_id is not None:
        records.append({"id": current_id, "seq": "".join(seqs)})
    return {"records": records, "query": records[0]["id"] if records else ""}

def compute_top_sites(rows: list[dict], n: int = 5) -> list[dict]:
    ranked = sorted(rows, key=lambda r: float(r.get("min", 0)), reverse=True)
    return [{"position": int(r["position"]), "min": float(r["min"]),
             "min_feature": r.get("min_feature", "")} for r in ranked[:n]]

def _meta_path(uniprot_id: str) -> Path:
    return config.OUTPUTS_DIR / uniprot_id / f"{uniprot_id}_meta.json"

def write_meta(uniprot_id: str, **fields):
    p = _meta_path(uniprot_id)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(fields, indent=2))

def read_meta(uniprot_id: str) -> dict | None:
    p = _meta_path(uniprot_id)
    return json.loads(p.read_text()) if p.exists() else None
