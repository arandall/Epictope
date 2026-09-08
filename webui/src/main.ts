import { fetchScore, fetchInfo, fetchMsa, fetchStatus } from "./api";
import { renderMinChart, topSites, type MinChartHandle } from "./chart";
import { renderMsa, type MsaHandle } from "./msa";
import { renderResultsHeader } from "./info";
import { mountSearch, type SearchHit } from "./search";
import { mountRunPanel } from "./run";
import { parseUrl, setUrl, onUrlChange, parseChunk } from "./state";
import { pushRecent } from "./recent";
import { initTheme, mountThemeToggle } from "./theme";
import { bus } from "./sync";

const $ = (id: string) => document.getElementById(id)!;
// Escape client-controlled strings (e.g. ?id= deep link, server error detail)
// before interpolating into innerHTML — error cards are the only sink fed
// directly from the URL.
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
let chartHandle: MinChartHandle | null = null;
let msaHandle: MsaHandle | null = null;
let busUnsub: (() => void) | null = null;
let markUnsub: (() => void) | null = null;

function showSkeletons() {
  $("results").hidden = false;
  document.body.dataset.view = "results";
  $("searchZone").classList.add("compact");
  $("errorBox").innerHTML = "";
  $("reshead").innerHTML = "";
  for (const id of ["chartCard", "msaCard"]) {
    $(id).innerHTML = `<div class="skeleton"></div>`;
  }
}

async function showResults(acc: string) {
  try {
    showSkeletons();
    const [rows, info, msa] = await Promise.all([fetchScore(acc), fetchInfo(acc), fetchMsa(acc)]);
    $("results").hidden = false;
    $("searchZone").classList.add("compact");
    const wrap = parseChunk();
    if (chartHandle) { chartHandle.chart.destroy(); chartHandle = null; }
    $("chartCard").innerHTML = `<p class="overline">Tagging score</p>
      <div class="chartwrap"><canvas id="chart"></canvas></div>`;
    chartHandle = renderMinChart($("chart") as HTMLCanvasElement, rows, topSites(rows));
    renderResultsHeader($("reshead"), info,
      (pos) => { bus.setMarked(pos); msaHandle?.scrollToPosition(pos); },
      () => {
        if (!chartHandle) return;
        const a = document.createElement("a");
        a.href = chartHandle.exportPng();
        a.download = `${acc}_min_score.png`;
        document.body.appendChild(a); a.click(); a.remove();
      },
      () => {
        // "New search": bring the (compacted) search box back into focus.
        window.scrollTo({ top: 0, behavior: "smooth" });
        const inp = document.querySelector<HTMLInputElement>("#search input");
        inp?.focus(); inp?.select();
      });
    $("msaCard").innerHTML = `<p class="overline">Multiple sequence alignment</p><div id="msa"></div>`;
    msaHandle = renderMsa($("msa"), msa, { wrap, onPositionClick: (pos) => bus.setMarked(pos) });
    chartHandle.setHoverCallback((pos) => bus.setActive(pos));
    // Clicking the chart marks the position and scrolls the window so the
    // matching MSA row (its chunk) is in view.
    chartHandle.setClickCallback((pos) => { if (pos != null) msaHandle?.scrollToPosition(pos); });
    busUnsub?.(); markUnsub?.();
    busUnsub = bus.onActive((pos) => chartHandle?.highlight(pos));
    markUnsub = bus.onMarked((pos) => chartHandle?.pin(pos));
  } catch (e) {
    msaHandle = null;
    // fetchScore/fetchInfo/fetchMsa reject with ApiError (e.g. stale ?id= deep link).
    $("results").hidden = true;
    delete document.body.dataset.view;
    $("searchZone").classList.remove("compact");
    $("errorBox").innerHTML = `<div class="card errorcard">
      <h3>Prediction failed for ${esc(acc)}</h3><p>${esc(e instanceof Error ? e.message : String(e))}</p>
      <button class="retry">Try again</button></div>`;
    $("errorBox").querySelector<HTMLButtonElement>(".retry")!.onclick = () => {
      $("errorBox").innerHTML = "";
      showResults(acc);
    };
  }
}

function showError(acc: string, message: string) {
  $("errorBox").innerHTML = `<div class="card errorcard">
    <h3>Prediction failed for ${esc(acc)}</h3><p>${esc(message)}</p>
    <button class="retry">Try again</button></div>`;
  $("errorBox").querySelector<HTMLButtonElement>(".retry")!.onclick = () => {
    $("errorBox").innerHTML = "";
    location.reload();
  };
}

const runPanel = mountRunPanel($("runPanel"), (acc) => {
  // "View results" / finished job: swap to the dedicated results view.
  runPanel.clear();
  $("runPanel").hidden = true;
  setUrl(acc);
  showResults(acc);
}, showError);

mountSearch($("search"), (hit: SearchHit) => {
  $("errorBox").innerHTML = "";
  // A fresh selection supersedes whatever is on screen: drop the old results
  // and the view marker so nothing stale shows behind the new search.
  $("results").hidden = true;
  delete document.body.dataset.view;
  $("runPanel").hidden = false;
  pushRecent({ q: hit.accession }); // selections count as recent searches too
  setUrl(hit.accession);
  runPanel.select(hit);
});

// Install-progress banner + run gating.
async function watchStatus() {
  const banner = $("banner");
  for (;;) {
    let s: Awaited<ReturnType<typeof fetchStatus>>;
    try {
      s = await fetchStatus();
    } catch {
      // Transient failure (network blip, server restart): keep the loop alive.
      await new Promise(r => setTimeout(r, 5000));
      continue;
    }
    if (s.installed) { banner.hidden = true; return; }
    banner.hidden = false;
    banner.textContent = `Preparing reference data — search works, predictions start when ready. ${s.progress || ""}`;
    await new Promise(r => setTimeout(r, 5000));
  }
}
watchStatus();

initTheme(); // re-applies the pre-paint choice + installs OS tracking
mountThemeToggle(document.querySelector("header.top")!);

// Deep link + browser back/forward: ?id=<acc> restores results from cache.
const initial = parseUrl();
if (initial) showResults(initial);
onUrlChange((acc) => { if (acc) showResults(acc); });
