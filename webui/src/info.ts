import { bus } from "./sync";
import { downloadScoreCsv, downloadMsaFasta, printResults } from "./downloads";

// Results header: protein summary, clickable top-site chips, downloads group.
export function renderResultsHeader(
  el: HTMLElement,
  info: any,
  onSiteClick: (pos: number) => void,
  onChartPng: () => void,
): void {
  el.innerHTML = `
    <h2>${info.uniprot_id} — ${info.gene || ""}</h2>
    <p class="sub">${info.organism || ""} · ${info.length} aa
      ${info.reviewed ? '<span class="tag">reviewed</span>' : ""}
      ${info.hasAlphaFold ? '<span class="tag">AlphaFold</span>' : ""}</p>
    ${info.resolution_note ? `<p class="hint">${info.resolution_note}</p>` : ""}
    <p class="overline">Top insertion sites</p>
    <div class="sites">${info.top_sites.map((s: any) =>
      `<button class="chip" data-pos="${s.position}">#${s.position} · min ${Number(s.min).toFixed(2)}</button>`).join("")}</div>
    <div class="downloads">
      <button data-dl="csv">Score CSV</button>
      <button data-dl="msa">MSA (FASTA)</button>
      <button data-dl="png">Chart PNG</button>
      <button data-dl="print">Print / PDF</button>
    </div>`;
  el.querySelectorAll<HTMLElement>(".chip").forEach(chip => {
    const pos = Number(chip.dataset.pos);
    chip.onclick = () => onSiteClick(pos);
    chip.onmouseenter = () => bus.setActive(pos);
    chip.onmouseleave = () => bus.setActive(null);
  });
  el.querySelector<HTMLElement>('[data-dl="csv"]')!.onclick = () => downloadScoreCsv(info.uniprot_id);
  el.querySelector<HTMLElement>('[data-dl="msa"]')!.onclick = () => downloadMsaFasta(info.uniprot_id);
  el.querySelector<HTMLElement>('[data-dl="png"]')!.onclick = onChartPng;
  el.querySelector<HTMLElement>('[data-dl="print"]')!.onclick = printResults;
}
