import { fetchScore, fetchInfo, fetchMsa, fetchStatus } from "./api";
import { renderMinChart, topSites, type MinChartHandle } from "./chart";
import { renderSequence } from "./sequence";
import { renderMsa } from "./msa";
import { renderResultsHeader } from "./info";
import { mountSearch, type SearchHit } from "./search";
import { mountRunPanel } from "./run";
import { parseUrl, setUrl, onUrlChange } from "./state";
import { bus } from "./sync";

const $ = (id: string) => document.getElementById(id)!;
let chartHandle: MinChartHandle | null = null;

function showSkeletons() {
  $("results").hidden = false;
  $("searchZone").classList.add("compact");
  $("errorBox").innerHTML = "";
  $("reshead").innerHTML = "";
  for (const id of ["chartCard", "seqCard", "msaCard"]) {
    $(id).innerHTML = `<div class="skeleton"></div>`;
  }
}

async function showResults(acc: string) {
  try {
    showSkeletons();
    const [rows, info, msa] = await Promise.all([fetchScore(acc), fetchInfo(acc), fetchMsa(acc)]);
    $("results").hidden = false;
    $("searchZone").classList.add("compact");
    if (chartHandle) { chartHandle.chart.destroy(); chartHandle = null; }
    $("chartCard").innerHTML = `<p class="overline">Tagging score</p>
      <div class="chartwrap"><canvas id="chart"></canvas></div>`;
    chartHandle = renderMinChart($("chart") as HTMLCanvasElement, rows, topSites(rows));
    renderResultsHeader($("reshead"), info,
      (pos) => chartHandle!.pin(pos),
      () => {
        if (!chartHandle) return;
        const a = document.createElement("a");
        a.href = chartHandle.exportPng();
        a.download = `${acc}_min_score.png`;
        document.body.appendChild(a); a.click(); a.remove();
      });
    $("seqCard").innerHTML = `<p class="overline">Query sequence</p><div id="sequence"></div>`;
    renderSequence($("sequence"), rows);
    $("msaCard").innerHTML = `<p class="overline">Multiple sequence alignment</p><div id="msa"></div>`;
    renderMsa($("msa"), msa);
    chartHandle.setHoverCallback((pos) => bus.setActive(pos));
    bus.onActive((pos) => chartHandle?.highlight(pos));
  } catch (e) {
    // fetchScore/fetchInfo/fetchMsa reject with ApiError (e.g. stale ?id= deep link).
    $("results").hidden = true;
    $("searchZone").classList.remove("compact");
    $("errorBox").innerHTML = `<div class="card errorcard">
      <h3>Prediction failed for ${acc}</h3><p>${e instanceof Error ? e.message : String(e)}</p>
      <button class="retry">Try again</button></div>`;
    $("errorBox").querySelector<HTMLButtonElement>(".retry")!.onclick = () => {
      $("errorBox").innerHTML = "";
      showResults(acc);
    };
  }
}

function showError(acc: string, message: string) {
  $("errorBox").innerHTML = `<div class="card errorcard">
    <h3>Prediction failed for ${acc}</h3><p>${message}</p>
    <button class="retry">Try again</button></div>`;
  $("errorBox").querySelector<HTMLButtonElement>(".retry")!.onclick = () => {
    $("errorBox").innerHTML = "";
    location.reload();
  };
}

const runPanel = mountRunPanel($("runPanel"), (acc) => { setUrl(acc); showResults(acc); }, showError);

mountSearch($("search"), (hit: SearchHit) => {
  $("errorBox").innerHTML = "";
  setUrl(hit.accession);
  runPanel.select(hit);
});

// Install-progress banner + run gating.
async function watchStatus() {
  const banner = $("banner");
  for (;;) {
    const s = await fetchStatus();
    if (s.installed) { banner.hidden = true; return; }
    banner.hidden = false;
    banner.textContent = `Preparing reference data — search works, predictions start when ready. ${s.progress || ""}`;
    await new Promise(r => setTimeout(r, 5000));
  }
}
watchStatus();

// Deep link + browser back/forward: ?id=<acc> restores results from cache.
const initial = parseUrl();
if (initial) showResults(initial);
onUrlChange((acc) => { if (acc) showResults(acc); });
