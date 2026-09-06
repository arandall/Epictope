import json
import urllib.error
import urllib.request
from web import uniprot

class FakeResp:
    """urlopen stand-in that also works as a context manager."""
    def __init__(self, payload): self._p = payload
    def read(self): return json.dumps(self._p).encode()
    def __enter__(self): return self
    def __exit__(self, *a): return False

def test_search_parses_json(monkeypatch):
    fake = {"results": [
        {"primaryAccession": "Q9W7E7", "genes": [{"geneName": {"value": "smad5"}}],
         "organism": {"scientificName": "Danio rerio"},
         "entryType": "UniProtKB reviewed",
         "uniProtKBCrossReferences": [{"database": "AlphaFoldDB", "id": "Q9W7E7"}]}]}
    monkeypatch.setattr(urllib.request, "urlopen", lambda *a, **k: FakeResp(fake))
    rows = uniprot.search("smad5")
    assert rows[0]["accession"] == "Q9W7E7"
    assert rows[0]["gene"] == "smad5"
    assert rows[0]["organism"] == "Danio rerio"
    assert rows[0]["reviewed"] is True
    assert rows[0]["hasAlphaFold"] is True

def test_search_network_failure_retries_then_empty(monkeypatch):
    calls = {"n": 0}
    def boom(*a, **k):
        calls["n"] += 1
        raise urllib.error.URLError("timed out")
    monkeypatch.setattr(urllib.request, "urlopen", boom)
    monkeypatch.setattr("time.sleep", lambda s: None)
    assert uniprot.search("smad5") == []
    assert calls["n"] == 2  # one retry

def test_search_empty_term_short_circuits(monkeypatch):
    monkeypatch.setattr(urllib.request, "urlopen",
                        lambda *a, **k: (_ for _ in ()).throw(AssertionError("no network")))
    assert uniprot.search("") == []
    assert uniprot.search("   ") == []

def test_resolve_uses_resolve_one(monkeypatch):
    from web.uniprot import resolve
    monkeypatch.setattr("web.uniprot.resolve_one",
                        lambda acc: {"input": acc, "resolved": "P12345", "reviewed": True,
                                     "af_id": "P12345", "note": "ok"})
    rows = resolve(["A0A0R4IFS9"])
    assert rows[0]["resolved"] == "P12345"