import { bus } from "./sync";
import { querySeq } from "./msa";
import type { MsaData } from "./msa";

let unsubActive: (() => void) | null = null;
let unsubMarked: (() => void) | null = null;

// The query sequence card renders the SAME gapped columns as the MSA (same
// 11px monospace strip, same chunk width) so the two cards align
// column-for-column. Residues keep their true `position`; gaps get no pos.
export function renderSequence(
  el: HTMLElement,
  rows: any[],
  opts: { msa?: MsaData; wrap?: number; onPositionClick?: (pos: number | null) => void } = {},
): void {
  el.innerHTML = "";
  const wrapEl = document.createElement("div");

  if (opts.msa) {
    const wrap = Math.max(1, opts.wrap ?? 200);
    const gapped = querySeq(opts.msa);
    let pos = 0;
    for (let start = 0; start < gapped.length; start += wrap) {
      const chunk = document.createElement("div");
      chunk.className = "seqchunk";
      const strip = document.createElement("span");
      strip.className = "seqstrip aligned";
      for (const ch of gapped.slice(start, start + wrap)) {
        const s = document.createElement("span");
        s.className = ch === "-" ? "res gap" : "res";
        if (ch !== "-") {
          pos += 1;
          s.dataset.pos = String(pos);
        }
        s.textContent = ch;
        strip.appendChild(s);
      }
      chunk.appendChild(strip);
      wrapEl.appendChild(chunk);
    }
  } else {
    // Legacy flat strip (ungapped score rows).
    wrapEl.className = "seqstrip";
    rows.forEach(r => {
      const s = document.createElement("span");
      s.className = "res";
      s.dataset.pos = String(r.position);
      s.textContent = r.aa;
      wrapEl.appendChild(s);
    });
  }
  el.appendChild(wrapEl);
  // Mouse-local tooltip (same .msatip pattern as the MSA) so the position popup
  // appears where the mouse is instead of only up on the chart.
  const tip = document.createElement("div");
  tip.className = "msatip";
  tip.hidden = true;
  el.appendChild(tip);

  // Delegated hover/click on residue spans (gap spans have no data-pos).
  wrapEl.addEventListener("mouseover", (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>(".res");
    if (!t?.dataset.pos) return;
    bus.setActive(Number(t.dataset.pos));
    const r = rows[Number(t.dataset.pos) - 1]; // score rows are 1-based, sequential
    tip.textContent = r ? `Position ${r.position} (${r.aa}) · min ${r.min}` : `Position ${t.dataset.pos}`;
    tip.style.left = `${e.clientX + 12}px`;
    tip.style.top = `${e.clientY + 14}px`;
    tip.hidden = false;
  });
  wrapEl.addEventListener("mouseleave", () => { bus.setActive(null); tip.hidden = true; });
  wrapEl.addEventListener("click", (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>(".res");
    if (t?.dataset.pos) opts.onPositionClick?.(Number(t.dataset.pos));
  });

  unsubActive?.();
  unsubMarked?.();
  unsubActive = bus.onActive(p => {
    wrapEl.querySelectorAll<HTMLElement>(".res").forEach(n =>
      n.classList.toggle("active", p != null && Number(n.dataset.pos) === p));
  });
  unsubMarked = bus.onMarked(p => {
    wrapEl.querySelectorAll<HTMLElement>(".res").forEach(n =>
      n.classList.toggle("marked", p != null && Number(n.dataset.pos) === p));
  });
}
