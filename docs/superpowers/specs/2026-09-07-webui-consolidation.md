# EpicTope Web UI Consolidation Spec

**Date:** 2026-09-07
**Status:** approved (user request, verbatim requirements below)
**Scope:** Small tweaks to the existing web UI + search. **No major architectural changes** — consolidate what already exists. Minimum number of tasks.

## Context

The web app (`web/` FastAPI backend, `webui/` Vite+TS frontend) shows, for a
UniProt accession: a min-score chart with top-site chips, a query sequence
strip, and a run-length-encoded multiple sequence alignment (MSA). Search is a
debounced type-ahead against `/api/search` (`web/uniprot.py`). A resolve
endpoint (`POST /api/resolve` → `scripts/resolve_accessions.py: resolve_one`)
already maps TrEMBL accessions to reviewed AlphaFold-backed accessions, but the
search flow never uses it.

Verified against live UniProt on 2026-09-07:
- `A0A2R8QSE0` and `A0A0R4IFS9` are unreviewed TrEMBL entries (gene `flt4`,
  taxid 7955) with **no** AlphaFold cross-reference.
- `resolve_one("A0A2R8QSE0")` → `{"resolved": "Q5MD89", "af_id": "Q5MD89", ...}`.
- MSA FASTA record ids are file paths, e.g. `data/CDS/Bos_taurus.ARS-UCD1.2.pep.all.fa`.

## Requirements

### UI

1. Top insertion site chips must be **clickable**: clicking pins the chart
   marker (already) AND scrolls the MSA horizontally so that column is visible.
2. The **query sequence** must align column-for-column with the MSA.
3. MSA row labels must strip the path (`data/CDS/…`) — show the base name.
4. For **printing**, the MSA must be split into lines (~every 200 columns).
5. The chart must show only **min (smoothed)** by default (raw min toggleable).
6. Top-site chips: red text on dark background is illegible → **red box, white
   text**.
7. The MSA currently forces a very wide page. Split it into rows of N columns;
   N configurable, **default 200**.
8. MSA colour runs are grouped: hovering must make clear that one letter = one
   position, and show the hovered run's full range (e.g. grey highlight).
9. Clicking a position must show a marker at that position across **chart,
   query sequence and MSA**.
10. The mouse-position popup must appear **where the mouse is** (chart point or
    sequence), not at the top-left corner.
11. The MSA **ruler must align** with the sequence text (same font/formatting,
    white-space preserved).
12. Searching again must be easy (a visible way to start a new search).
13. The search page shows the **previous 10 searches**.

### Search

14. Searching any UniProt ID must help resolve it. In particular
    `A0A2R8QSE0` and `A0A0R4IFS9` must resolve to **Q5MD89**.
15. On selection, show more information to help find the right ID (resolution
    notes, offer to use the resolved accession).
16. Search-as-you-type is silly: replace with an explicit **Search button** /
    Enter key.

## Non-goals

- No new frameworks or dependencies.
- No pipeline (R) changes.
- No redesign of the card layout, colour scheme tokens, or API surface beyond
  additive fields on `/api/search` hits.
- Downloads keep the original full FASTA ids (basename stripping is display-only).
