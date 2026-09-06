import json
import sys
import urllib.parse
import urllib.request
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent.parent / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))
from resolve_accessions import resolve_one  # noqa: E402

UNIPROT_API = "https://rest.uniprot.org/uniprotkb/search"

def _get_json(url, params=None):
    if params:
        url = url + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    resp = urllib.request.urlopen(req, timeout=30)
    return json.loads(resp.read().decode("utf-8"))

def search(term: str) -> list[dict]:
    data = _get_json(UNIPROT_API, params={
        "query": term,
        "fields": "accession,id,gene_names,organism_name,reviewed,xref_alphafolddb",
        "format": "json", "size": "20",
    })
    out = []
    for r in data.get("results", []):
        af = any(x.get("database") == "AlphaFoldDB" for x in r.get("uniProtKBCrossReferences", []))
        gene = ""
        if r.get("genes"):
            gene = r["genes"][0].get("geneName", {}).get("value", "")
        out.append({
            "accession": r.get("primaryAccession", ""),
            "gene": gene,
            "organism": r.get("organism", {}).get("scientificName", ""),
            "reviewed": str(r.get("entryType", "")).startswith("UniProtKB reviewed"),
            "hasAlphaFold": af,
        })
    return out

def resolve(accessions: list[str]) -> list[dict]:
    return [resolve_one(acc) for acc in accessions]
