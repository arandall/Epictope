import { bus } from "./sync";
// Only the latest render's bus listeners stay attached: re-registering on every
// renderMsa call unsubscribes the previous closures (which referenced a
// now-detached subtree).
let unsubActive: (() => void) | null = null;
let unsubMarked: (() => void) | null = null;

export type CellColor = "red" | "blue" | "yellow";
export function colorForColumn(seqs: string[], col: number): CellColor {
  const chars = seqs.map(s => s[col] ?? "-");
  if (chars.some(c => c === "-")) return "yellow";
  if (chars.every(c => c === chars[0])) return "red";
  return "blue";
}

export interface MsaData { query: string; records: { id: string; seq: string }[] }

// True query residue number per MSA column (counts non-gap chars in the query
// row), so hover/click link to the chart by real residue position.
export function queryPositions(msa: MsaData): (number | null)[] {
  const q = querySeq(msa);
  let count = 0;
  return q.split("").map(ch => {
    if (ch === "-") return null;
    count += 1;
    return count;
  });
}

// The query row's gapped sequence (empty string when there are no records).
export function querySeq(msa: MsaData): string {
  return (msa.records.find(r => r.id === msa.query) ?? msa.records[0])?.seq ?? "";
}

export interface ColorRun { color: CellColor; text: string }

// Run-length encode one alignment row (kept for callers/tests that want runs).
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

// "data/CDS/Bos_taurus.ARS-UCD1.2.pep.all.fa" -> "Bos_taurus.ARS-UCD1.2.pep.all.fa"
export function baseName(id: string): string {
  const parts = id.split(/[\\/]/);
  return parts[parts.length - 1] || id;
}

// Two-line ruler for one chunk, EXACTLY `len` chars per line, using absolute
// 1-based alignment columns: "|" ticks and right-aligned labels at multiples
// of 10. Rendered in the same font/size as the sequence strips so columns line
// up character-for-character (white-space: pre). With `markCol` (0-based
// absolute column), the tick at that column becomes a "▼" arrow and its
// absolute column number is placed right-aligned above it (overwriting any
// multiple-of-10 label there) so the clicked column is easy to spot.
export function rulerFor(startCol: number, len: number, markCol?: number): string {
  const tick: string[] = Array.from({ length: len }, (_, i) => ((startCol + i + 1) % 10 === 0 ? "|" : " "));
  const label = Array.from({ length: len }, () => " ");
  // Right-aligns String(value) so its last digit lands on index `end`.
  const placeLabel = (end: number, value: number) => {
    const s = String(value);
    for (let k = 0; k < s.length && end - s.length + 1 + k >= 0; k++) {
      label[end - s.length + 1 + k] = s[k];
    }
  };
  for (let c = Math.ceil((startCol + 1) / 10) * 10; c <= startCol + len; c += 10) {
    placeLabel(c - startCol - 1, c);
  }
  if (markCol != null && markCol >= startCol && markCol < startCol + len) {
    tick[markCol - startCol] = "▼";
    placeLabel(markCol - startCol, markCol + 1);
  }
  return `${label.join("")}\n${tick.join("")}`;
}

// Render a chunk's ruler. Unmarked chunks are plain text; the chunk owning
// the marked column wraps the column number and the "▼" arrow in .rulermark
// spans so ONLY those glyphs get the highlight colour — the ruler row itself
// must not light up. textContent always equals rulerFor(start, len, markCol),
// so the two-line layout and column alignment are preserved. (Content is
// provably [0-9 |▼], so innerHTML interpolation is safe.)
function renderRuler(el: HTMLElement, startCol: number, len: number, markCol?: number): void {
  if (markCol == null || markCol < startCol || markCol >= startCol + len) {
    el.textContent = rulerFor(startCol, len);
    return;
  }
  const [label, tick] = rulerFor(startCol, len, markCol).split("\n");
  const i = markCol - startCol;
  const num = String(markCol + 1);
  const j = i - num.length + 1; // the number is right-aligned ending at i
  el.innerHTML =
    `${label.slice(0, j)}<span class="rulermark">${label.slice(j, i + 1)}</span>${label.slice(i + 1)}` +
    `\n` +
    `${tick.slice(0, i)}<span class="rulermark arr">${tick[i]}</span>${tick.slice(i + 1)}`;
}

export interface MsaHandle {
  scrollToPosition(pos: number): void;
  markPosition(pos: number | null): void;
}

function clearRange(strip: HTMLElement): void {
  strip.querySelectorAll(".cell.inrange").forEach(n => n.classList.remove("inrange"));
}

function onCellHover(e: MouseEvent, strip: HTMLElement, qpos: (number | null)[], tip: HTMLElement): void {
  const t = (e.target as HTMLElement).closest<HTMLElement>(".cell");
  if (!t || !strip.contains(t)) return;
  const col = Number(t.dataset.col);
  bus.setActive(qpos[col] ?? null);
  clearRange(strip);
  // Grey the whole contiguous same-colour run so grouped regions read as one
  // range, while the single hovered letter keeps its own outline.
  const color = ["red", "blue", "yellow"].find(c => t.classList.contains(c));
  if (color) {
    let a: Element = t;
    let b: Element = t;
    while (a.previousElementSibling?.classList.contains(color)) a = a.previousElementSibling;
    while (b.nextElementSibling?.classList.contains(color)) b = b.nextElementSibling;
    const start = Number((a as HTMLElement).dataset.col);
    const end = Number((b as HTMLElement).dataset.col);
    for (let n: Element | null = a; n; n = n.nextElementSibling) {
      n.classList.add("inrange");
      if (n === b) break;
    }
    tip.textContent = end > start
      ? `Cols ${start + 1}–${end + 1} · query ${qpos[col] ?? "gap"}`
      : `Col ${col + 1} · query ${qpos[col] ?? "gap"} · ${t.textContent}`;
  }
  tip.style.left = `${e.clientX + 12}px`;
  tip.style.top = `${e.clientY + 14}px`;
  tip.hidden = false;
}

export function renderMsa(
  el: HTMLElement,
  msa: MsaData,
  opts: { wrap?: number; onPositionClick?: (pos: number | null) => void } = {},
): MsaHandle {
  const wrap = Math.max(1, opts.wrap ?? 200);
  const seqs = msa.records.map(r => r.seq);
  const qpos = queryPositions(msa);
  const nCols = Math.max(...seqs.map(s => s.length), 0);
  el.innerHTML = "";

  const head = document.createElement("div");
  head.className = "msahead";
  head.innerHTML = `<span class="legend"><i class="sw red"></i>conserved <i class="sw blue"></i>differs <i class="sw yellow"></i>gap · one letter = one position · click a column to mark it</span>`;
  el.appendChild(head);
  const viewport = document.createElement("div");
  viewport.className = "msaviewport";
  el.appendChild(viewport);
  const tip = document.createElement("div");
  tip.className = "msatip";
  tip.hidden = true;
  el.appendChild(tip);

  for (let start = 0; start < nCols; start += wrap) {
    const len = Math.min(wrap, nCols - start);
    const chunk = document.createElement("div");
    chunk.className = "msachunk";
    chunk.dataset.start = String(start);
    chunk.dataset.len = String(len);
    const ch = document.createElement("div");
    ch.className = "chunkhead";
    ch.textContent = `Columns ${start + 1}–${start + len}`;
    chunk.appendChild(ch);
    const block = document.createElement("div");
    block.className = "msablock";
    chunk.appendChild(block);

    // Ruler row: same .msastrip font as sequence rows so it aligns exactly.
    const rrow = document.createElement("div");
    rrow.className = "msarow";
    const rsp = document.createElement("span");
    rsp.className = "msaname";
    rrow.appendChild(rsp);
    const ruler = document.createElement("span");
    ruler.className = "msastrip msaruler";
    ruler.textContent = rulerFor(start, len);
    rrow.appendChild(ruler);
    block.appendChild(rrow);

    msa.records.forEach((rec, rowIdx) => {
      const row = document.createElement("div");
      row.className = "msarow";
      if (rec.id === msa.query) row.classList.add("queryrow");
      const name = document.createElement("span");
      name.className = "msaname";
      name.textContent = baseName(rec.id);
      name.title = rec.id; // full path on hover
      if (rec.id === msa.query) name.classList.add("isquery");
      row.appendChild(name);
      const strip = document.createElement("span");
      strip.className = "msastrip";
      for (let c = start; c < start + len; c++) {
        const s = document.createElement("span");
        s.className = `cell ${colorForColumn(seqs, c)}`;
        s.dataset.col = String(c);
        s.textContent = rec.seq[c] ?? "-";
        strip.appendChild(s);
      }
      strip.addEventListener("mousemove", (e) => onCellHover(e, strip, qpos, tip));
      strip.addEventListener("mouseleave", () => { clearRange(strip); tip.hidden = true; bus.setActive(null); });
      strip.addEventListener("click", (e) => {
        const t = (e.target as HTMLElement).closest<HTMLElement>(".cell");
        if (t && strip.contains(t)) opts.onPositionClick?.(qpos[Number(t.dataset.col)] ?? null);
      });
      row.appendChild(strip);
      block.appendChild(row);
    });
    viewport.appendChild(chunk);

    // Lift the query row out of the ortholog list and pin it directly under
    // the ruler in every chunk — the query sequence and the alignment share
    // the same wrapped view and stay visually paired at any scroll offset.
    const qrow = block.querySelector<HTMLElement>(".msarow.queryrow");
    if (qrow) block.insertBefore(qrow, rrow.nextSibling);
  }

  const colCells = (col: number) => el.querySelectorAll<HTMLElement>(`.cell[data-col="${col}"]`);
  const handle: MsaHandle = {
    scrollToPosition(pos) {
      const col = qpos.indexOf(pos);
      if (col < 0) return;
      const chunkEl = viewport.querySelectorAll<HTMLElement>(".msachunk")[Math.floor(col / wrap)];
      chunkEl?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      const block = chunkEl?.querySelector<HTMLElement>(".msablock");
      const cell = chunkEl?.querySelector<HTMLElement>(`.cell[data-col="${col}"]`);
      if (block && cell) {
        // rect math works regardless of CSS offsetParent chains
        const d = cell.getBoundingClientRect().left - block.getBoundingClientRect().left;
        block.scrollLeft += d - (block.clientWidth - cell.getBoundingClientRect().width) / 2;
      }
    },
    markPosition(pos) {
      el.querySelectorAll(".cell.marked").forEach(n => n.classList.remove("marked"));
      const col = pos == null ? -1 : qpos.indexOf(pos);
      // Redraw every ruler: the chunk owning the marked column gets the "▼"
      // arrow + column number, the rest go back to plain — this also handles
      // unmarking (pos == null).
      viewport.querySelectorAll<HTMLElement>(".msachunk").forEach(chunk => {
        const start = Number(chunk.dataset.start);
        const len = Number(chunk.dataset.len);
        renderRuler(chunk.querySelector(".msaruler")!, start, len,
          col >= start && col < start + len ? col : undefined);
      });
      if (col >= 0) colCells(col).forEach(n => n.classList.add("marked"));
    },
  };

  unsubActive?.();
  unsubMarked?.();
  unsubActive = bus.onActive(pos => {
    const col = pos == null ? -1 : qpos.indexOf(pos);
    el.querySelectorAll<HTMLElement>(".cell").forEach(n => {
      n.classList.toggle("active", col >= 0 && Number(n.dataset.col) === col);
    });
  });
  unsubMarked = bus.onMarked(pos => handle.markPosition(pos));
  return handle;
}
