import { fetchSearch, runPrediction, fetchJob, fetchScore, fetchInfo } from "./api";
import { renderScoreChart, topSites } from "./chart";
import { renderSequence } from "./sequence";
import { bus } from "./sync";
const $ = (id:string)=>document.getElementById(id)!;
let chartHandle: any = null;

$("searchBtn").onclick = async () => {
  const rows:any[] = await fetchSearch(($("search") as HTMLInputElement).value);
  ($("results") as HTMLElement).innerHTML = rows.map((r:any)=>
    `<div class="res"><b>${r.accession}</b> ${r.gene} ${r.organism}
     ${r.reviewed?"<span class=tag>reviewed</span>":""}
     ${r.hasAlphaFold?"<span class=tag>AF</span>":""}
     <button data-acc="${r.accession}">Run</button></div>`).join("");
  ($("results") as HTMLElement).querySelectorAll<HTMLElement>("button[data-acc]").forEach(b=>{
    b.onclick=()=>startRun((b as HTMLElement).dataset.acc!);
  });
};
async function startRun(acc: string) {
  const nterm = ($("nterm") as HTMLInputElement).value;
  const file = ($("cif") as HTMLInputElement).files?.[0] ?? null;
  const { job_id } = await runPrediction(acc, nterm?Number(nterm):null, file);
  poll(job_id, acc);
}
async function poll(job_id:string, acc:string) {
  const job:any = await fetchJob(job_id);
  if (job.status === "done") return showResults(acc);
  if (job.status === "error") { ($("info") as HTMLElement).textContent = "Error: "+job.error; return; }
  setTimeout(()=>poll(job_id, acc), 1500);
}
async function showResults(acc:string) {
  const rows:any[] = await fetchScore(acc);
  const info:any = await fetchInfo(acc);
  ($("info") as HTMLElement).innerHTML = `<h2>${acc}</h2>
     <p>${info.gene} — ${info.organism}</p>
     <p>Top sites: ${info.top_sites.map((s:any)=>s.position).join(", ")}</p>`;
  if (chartHandle) chartHandle.chart.destroy();
  chartHandle = renderScoreChart($("chart") as HTMLCanvasElement, rows, topSites(rows));
  renderSequence($("sequence") as HTMLElement, rows);
  chartHandle.setHoverCallback((pos:number|null)=>bus.setActive(pos));
  bus.onActive((pos)=>chartHandle.highlight(pos));
}
