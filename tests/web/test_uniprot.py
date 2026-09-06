import json
import urllib.request
from web import uniprot

def test_search_parses_json(monkeypatch):
    fake = {"results": [
        {"primaryAccession": "Q9W7E7", "genes": [{"geneName": {"value": "smad5"}}],
         "organism": {"scientificName": "Danio rerio"},
         "entryType": "UniProtKB reviewed",
         "uniProtKBCrossReferences": [{"database": "AlphaFoldDB", "id": "Q9W7E7"}]}]}
    monkeypatch.setattr(urllib.request, "urlopen",
                        lambda *a, **k: type("R", (), {"read": lambda self: json.dumps(fake).encode()})())
    rows = uniprot.search("smad5")
    assert rows[0]["accession"] == "Q9W7E7"
    assert rows[0]["gene"] == "smad5"
    assert rows[0]["organism"] == "Danio rerio"
    assert rows[0]["reviewed"] is True
    assert rows[0]["hasAlphaFold"] is True

def test_resolve_uses_resolve_one(monkeypatch):
    from web.uniprot import resolve
    monkeypatch.setattr("web.uniprot.resolve_one",
                        lambda acc: {"input": acc, "resolved": "P12345", "reviewed": True,
                                     "af_id": "P12345", "note": "ok"})
    rows = resolve(["A0A0R4IFS9"])
    assert rows[0]["resolved"] == "P12345"
