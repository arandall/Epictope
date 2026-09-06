import json
import logging
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent.parent / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))
from resolve_accessions import resolve_one  # noqa: E402

UNIPROT_API = "https://rest.uniprot.org/uniprotkb/search"
log = logging.getLogger(__name__)

def _get_json(url, params=None):
    if params:
        url = url + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))

def search(term: str) -> list[dict]:
    term = (term or "").strip()
    if not term:
        return []
    params = {"query": term,
              "fields": "accession,id,gene_names,organism_name,reviewed,xref_alphafolddb",
              "format": "json", "size": "20"}
    data = None
    for attempt in (1, 2):
        try:
            data = _get_json(UNIPROT_API, params=params)
            break
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
            log.warning("UniProt search attempt %d failed: %s", attempt, e)
            if attempt == 2:
                return []
            time.sleep(1)
    out = []
    for r in (data or {}).get("results", []):
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