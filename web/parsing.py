import csv
import json
from pathlib import Path
from web import config

NUMERIC_COLS = {"position", "normalized_entropy", "ss_score", "rsa", "inv_anchor2",
                "sum_score", "min", "shannon", "resnum", "sasa", "phi", "psi",
                "iupred2", "anchor2"}

def _num(v):
    if v is None:
        return None
    v = str(v).strip()
    if v in ("", "NA", "NaN", "nan"):
        return None
    try:
        f = float(v)
    except ValueError:
        return v
    return int(f) if f.is_integer() else f

def parse_score_csv(path) -> list[dict]:
    with Path(path).open() as fh:
        return [{k: (_num(v) if k in NUMERIC_COLS else v) for k, v in r.items()}
                for r in csv.DictReader(fh)]

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
    mins = [float(r.get("min") or 0) for r in rows]
    peaks = []
    for i, m in enumerate(mins):
        left = mins[i - 1] if i > 0 else float("-inf")
        right = mins[i + 1] if i < len(mins) - 1 else float("-inf")
        if m > left and m > right:
            r = rows[i]
            peaks.append({"position": int(r["position"]), "min": m,
                          "min_feature": r.get("min_feature", "")})
    peaks.sort(key=lambda p: p["min"], reverse=True)
    return peaks[:n]

def _meta_path(uniprot_id: str) -> Path:
    return config.OUTPUTS_DIR / uniprot_id / f"{uniprot_id}_meta.json"

def write_meta(uniprot_id: str, **fields):
    p = _meta_path(uniprot_id)
    p.parent.mkdir(parents=True, exist_ok=True)
    fields["uniprot_id"] = uniprot_id
    p.write_text(json.dumps(fields, indent=2))

def read_meta(uniprot_id: str) -> dict | None:
    p = _meta_path(uniprot_id)
    return json.loads(p.read_text()) if p.exists() else None