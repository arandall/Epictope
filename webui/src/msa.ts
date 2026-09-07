import { bus } from "./sync";
export type CellColor = "red"|"blue"|"yellow";
export function colorForColumn(seqs: string[], col: number): CellColor {
  const chars = seqs.map(s => s[col] ?? "-");
  if (chars.some(c => c === "-")) return "yellow";
  if (chars.every(c => c === chars[0])) return "red";
  return "blue";
}
// True query residue number per MSA column (counts non-gap chars in the query row),
// so hover links to the chart by real residue position even when gaps exist.
export function queryPositions(msa: { query: string; records: { id: string; seq: string }[] }): (number|null)[] {
  const q = (msa.records.find(r => r.id === msa.query) ?? msa.records[0])?.seq ?? "";
  let count = 0;
  return q.split("").map(ch => {
    if (ch === "-") return null;
    count += 1;
    return count;
  });
}

export interface ColorRun { color: CellColor; text: string; }

// Run-length encode one alignment row: consecutive columns sharing a color
// become a single run, so the DOM gets O(runs) nodes per row instead of
// O(columns) — keeps large alignments snappy.
export function colorRuns(seqs: string[], row: number): ColorRun[] {
  const seq = seqs[row] ?? "";
  const runs: ColorRun[] = [];
  for (let c = 0; c < seq.length; c++) {
    const color = colorForColumn(seqs, c);
    const last = runs[runs.length - 1];
    if (last && last.color === color) last.text += seq[c];
    else runs.push({ color, text: seq[c] });
  }
  return runs;
}

export function renderMsa(el: HTMLElement, msa: { query: string; records: { id: string; seq: string }[] }) {
  const seqs = msa.records.map(r => r.seq);
  const qpos = queryPositions(msa);
  el.innerHTML = "";
  const head = document.createElement("div"); head.className = "msahead";
  head.innerHTML = `<span class="legend"><i class="sw red"></i>conserved <i class="sw blue"></i>differs <i class="sw yellow"></i>gap</span>`;
  el.appendChild(head);
  const viewport = document.createElement("div"); viewport.className = "msaviewport";
  el.appendChild(viewport);
  // Ruler: monospace strip aligned with the columns below; "|" marks every
  // 10th column and multiples of 10 are labeled (labels overflow harmlessly
  // at the strip's end — it scrolls with the rows).
  const nCols = Math.max(...msa.records.map(r => r.seq.length), 0);
  if (nCols > 0) {
    const tick = Array.from({ length: nCols }, (_, i) => ((i + 1) % 10 === 0 ? "|" : " ")).join("");
    const label = Array.from({ length: nCols }, () => " ");
    for (let c = 10; c <= nCols; c += 10) {
      const s = String(c);
      for (let k = 0; k < s.length && c - s.length + k >= 0; k++) label[c - s.length + k] = s[k];
    }
    const rrow = document.createElement("div"); rrow.className = "msarow";
    const rname = document.createElement("span"); rname.className = "msaname";
    rrow.appendChild(rname);
    const ruler = document.createElement("span"); ruler.className = "msastrip msaruler";
    ruler.textContent = `${label.join("")}\n${tick}`;
    rrow.appendChild(ruler); viewport.appendChild(rrow);
  }
  msa.records.forEach((rec, rowIdx) => {
    const row = document.createElement("div"); row.className = "msarow";
    const name = document.createElement("span"); name.className = "msaname"; name.textContent = rec.id;
    row.appendChild(name);
    const strip = document.createElement("span"); strip.className = "msastrip";
    let col = 0;
    for (const run of colorRuns(seqs, rowIdx)) {
      const s = document.createElement("span");
      s.className = `cell ${run.color}`;
      s.dataset.start = String(col);
      s.dataset.end = String(col + run.text.length - 1);
      s.textContent = run.text;
      strip.appendChild(s);
      col += run.text.length;
    }
    // Delegated hover: column from pointer x relative to the strip (clientX - rect.left;
    // offsetX would be relative to the innermost .cell target, not the strip).
    strip.addEventListener("mousemove", (e) => {
      const rect = strip.getBoundingClientRect();
      const len = rec.seq.length;
      if (rect.width <= 0 || len === 0) return;
      const x = e.clientX - rect.left;
      const c = Math.min(len - 1, Math.max(0, Math.floor((x / rect.width) * len)));
      bus.setActive(qpos[c]);
    });
    strip.addEventListener("mouseleave", () => bus.setActive(null));
    row.appendChild(strip); viewport.appendChild(row);
  });
  bus.onActive(pos => {
    el.querySelectorAll<HTMLElement>(".cell").forEach(n => {
      const start = Number(n.dataset.start), end = Number(n.dataset.end);
      const qIdx = pos == null ? -1 : qpos.indexOf(pos);
      n.classList.toggle("active", qIdx >= 0 && qIdx >= start && qIdx <= end);
    });
  });
}
