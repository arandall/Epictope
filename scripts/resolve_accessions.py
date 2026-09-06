#!/usr/bin/env python3
"""Resolve UniProt accessions to AlphaFold-backed accessions for Epictope.

Epictope needs an AlphaFold structure (mmCIF) to compute DSSP. It works
reliably only for accessions that have an AlphaFoldDB cross-reference in
UniProt -- which is almost always true for *reviewed* (Swiss-Prot) entries
and often false for *TrEMBL* (predicted) entries.

Given an input accession (typically a TrEMBL predicted isoform from a bulk
annotation pipeline), this script finds the reviewed entry for the same
gene + organism that DOES carry an AlphaFold model, so you can feed that ID
to `scripts/single_score.R`.

Usage:
    # resolve one or more accessions (prints a mapping table)
    python3 scripts/resolve_accessions.py A0A0R4IFS9 A0A2R8QSE0

    # resolve every accession listed in a file (one per line)
    python3 scripts/resolve_accessions.py -f ids.txt

    # also download the resolved AlphaFold models into data/models/
    # so single_score.R picks them up without re-downloading
    python3 scripts/resolve_accessions.py --fetch A0A0R4IFS9 A0A2R8QSE0

    # custom models directory (defaults to <repo>/data/models)
    python3 scripts/resolve_accessions.py --models-dir /path/to/data/models A0A0R4IFS9

The resolved accessions are printed one-per-line to stdout (after the table
on stderr) so they can be piped into a loop that calls single_score.R.
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

UNIPROT_API = "https://rest.uniprot.org/uniprotkb"
ALPHAFOLD_BASE = "https://alphafold.ebi.ac.uk/files/"


def _get_json(url, params=None):
    if params:
        url = url + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _af_xref(entry):
    """Return the AlphaFoldDB cross-reference id for a UniProt entry, or None."""
    for x in entry.get("uniProtKBCrossReferences", []):
        if x.get("database") == "AlphaFoldDB":
            return x.get("id")
    return None


def _gene_name(entry):
    for g in entry.get("genes", []):
        val = g.get("geneName", {}).get("value")
        if val:
            return val
    return None


def _organism_taxid(entry):
    return entry.get("organism", {}).get("taxonId")


def _is_reviewed(entry):
    return entry.get("entryType", "").startswith("UniProtKB reviewed")


def resolve_one(accession):
    """Return a dict describing how to make `accession` work with Epictope."""
    out = {
        "input": accession,
        "exists": False,
        "reviewed": None,
        "af_id": None,
        "resolved": None,
        "note": "",
    }
    try:
        entry = _get_json(f"{UNIPROT_API}/{accession}.json")
    except urllib.error.HTTPError as e:
        if e.code == 404:
            out["note"] = "accession not found in UniProt"
            return out
        out["note"] = f"UniProt lookup failed: HTTP {e.code}"
        return out

    out["exists"] = True
    out["reviewed"] = _is_reviewed(entry)
    out["af_id"] = _af_xref(entry)

    # Case 1: the input accession itself has an AlphaFold model.
    if out["af_id"]:
        out["resolved"] = entry.get("primaryAccession")
        out["note"] = "input accession already has an AlphaFold model"
        return out

    # Case 2: find a reviewed entry for the same gene + organism that has one.
    gene = _gene_name(entry)
    taxid = _organism_taxid(entry)
    if not gene or not taxid:
        out["note"] = "no AlphaFold model and cannot map to a reviewed ortholog"
        return out

    query = f"gene:{gene} AND organism_id:{taxid} AND reviewed:true"
    try:
        results = _get_json(
            f"{UNIPROT_API}/search",
            params={
                "query": query,
                "fields": "accession,xref_alphafolddb",
                "format": "json",
                "size": "20",
            },
        )
    except urllib.error.HTTPError as e:
        out["note"] = f"reviewed-entry search failed: HTTP {e.code}"
        return out

    for r in results.get("results", []):
        af = _af_xref(r)
        if af:
            out["resolved"] = r.get("primaryAccession")
            out["af_id"] = af
            out["note"] = (
                f"resolved to reviewed ortholog (gene={gene}); "
                "structure is for the canonical entry, not the exact input isoform"
            )
            return out

    out["note"] = f"no reviewed {gene} entry with an AlphaFold model was found"
    return out


def fetch_model(af_id, models_dir):
    """Download AF-<af_id>-F1-model_v6.cif into models_dir; return path or None."""
    filename = f"AF-{af_id}-F1-model_v6.cif"
    url = ALPHAFOLD_BASE + filename
    os.makedirs(models_dir, exist_ok=True)
    dest = os.path.join(models_dir, filename)
    if os.path.exists(dest):
        return dest
    try:
        urllib.request.urlretrieve(url, dest)
        return dest
    except Exception as e:  # noqa: BLE001
        if os.path.exists(dest):
            os.remove(dest)
        print(f"  ! failed to download {url}: {e}", file=sys.stderr)
        return None


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("accessions", nargs="*", help="UniProt accession(s) to resolve")
    ap.add_argument("-f", "--file", help="file with one accession per line")
    ap.add_argument("--fetch", action="store_true",
                    help="download resolved AlphaFold models into --models-dir")
    ap.add_argument("--models-dir", default=None,
                    help="directory to download models into (default: <repo>/data/models)")
    args = ap.parse_args()

    accessions = list(args.accessions)
    if args.file:
        with open(args.file) as fh:
            for line in fh:
                line = line.strip()
                if line and not line.startswith("#"):
                    accessions.append(line)
    if not accessions:
        ap.error("provide accession(s) or --file")

    here = os.path.dirname(os.path.abspath(__file__))
    models_dir = args.models_dir or os.path.join(here, "..", "data", "models")

    resolved = []
    print(f"{'INPUT':<14} {'RESOLVED':<14} {'REVIEWED':<9} {'AF MODEL':<10} NOTE",
          file=sys.stderr)
    print("-" * 78, file=sys.stderr)
    for acc in accessions:
        r = resolve_one(acc)
        af = r["af_id"] or "-"
        rev = "-" if r["reviewed"] is None else ("yes" if r["reviewed"] else "no")
        res = r["resolved"] or "-"
        print(f"{r['input']:<14} {res:<14} {rev:<9} {af:<10} {r['note']}",
              file=sys.stderr)
        if r["resolved"]:
            resolved.append(r["resolved"])
            if args.fetch and r["af_id"]:
                path = fetch_model(r["af_id"], models_dir)
                if path:
                    print(f"  -> saved {path}", file=sys.stderr)

    # Clean newline-separated resolved ids on stdout for piping.
    print("\n".join(resolved))


if __name__ == "__main__":
    main()
