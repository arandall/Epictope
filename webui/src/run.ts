import { runPrediction, fetchJob, fetchScore, fetchResolve, ApiError } from "./api";
import type { SearchHit } from "./search";

export function mountRunPanel(
  root: HTMLElement,
  onDone: (acc: string) => void,
  onError: (acc: string, message: string) => void,
) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let gen = 0;

  const poll = (jobId: string, acc: string, g: number, fails = 0) => {
    timer = setTimeout(async () => {
      let job: Awaited<ReturnType<typeof fetchJob>>;
      try {
        job = await fetchJob(jobId);
      } catch {
        // Transient failure (network blip, server restart): retry, then give up.
        if (g !== gen) return; // panel was cleared or re-selected mid-await
        if (fails + 1 >= 5) {
          onError(acc, "lost contact with the server while running the prediction");
          return;
        }
        poll(jobId, acc, g, fails + 1);
        return;
      }
      if (g !== gen) return; // panel was cleared or re-selected mid-await
      if (job.status === "done") { onDone(acc); return; }
      if (job.status === "error") { onError(acc, job.error ?? "unknown error"); return; }
      poll(jobId, acc, g);
    }, 1500);
  };

  // Hoisted so the "Use resolved accession" button can re-select recursively.
  function select(hit: SearchHit): void {
    gen += 1;
    root.innerHTML = `
      <div class="card selected">
        <div class="selmain">
          <h2>${hit.gene || hit.accession}</h2>
          <p class="sub">${hit.accession} · ${hit.organism}
            ${hit.reviewed ? '<span class="tag">reviewed</span>' : ""}
            ${hit.hasAlphaFold ? '<span class="tag">AlphaFold</span>' : '<span class="tag warn">no AlphaFold</span>'}</p>
          ${hit.protein ? `<p class="sub">${hit.protein}</p>` : ""}
        </div>
        <button class="primary">Run prediction</button>
      </div>
      <p class="resolve-note hint" hidden></p>
      <details class="advanced">
        <summary>Advanced options <span class="hint">(optional — custom structure)</span></summary>
        <div class="advbody">
          <p class="hint">Only needed if this protein has no AlphaFold model. Upload a custom
             .cif structure and, if it covers only part of the protein, the N-terminal residue
             of the structure.</p>
          <label>Custom structure (.cif) <input type="file" accept=".cif" class="cif"/></label>
          <label>N-terminal residue <input type="number" min="1" class="nterm" placeholder="1"/></label>
        </div>
      </details>
      <p class="progress" hidden></p>`;
    const btn = root.querySelector<HTMLButtonElement>("button.primary")!;
    const progress = root.querySelector<HTMLElement>(".progress")!;
    const note = root.querySelector<HTMLElement>(".resolve-note")!;

    // Where this hit came from a resolution, say so.
    if (hit.resolvedFrom) {
      note.hidden = false;
      note.textContent = `Resolved from ${hit.resolvedFrom}${hit.resolveNote ? ` — ${hit.resolveNote}` : ""}`;
    }

    // No AlphaFold model on the selected entry: try to resolve to a reviewed
    // ortholog (e.g. A0A2R8QSE0 -> Q5MD89) and offer a one-click switch.
    if (!hit.hasAlphaFold) {
      const g = gen;
      note.hidden = false;
      note.textContent = `${hit.accession} has no AlphaFold model — checking for a reviewed entry…`;
      fetchResolve([hit.accession]).then((rows: any[]) => {
        if (g !== gen) return; // cleared or re-selected mid-request
        const r = rows?.[0];
        if (r?.resolved && r.resolved !== hit.accession) {
          note.textContent = `${r.note ?? "A reviewed entry is available."} `;
          const use = document.createElement("button");
          use.type = "button";
          use.className = "useresolved";
          use.textContent = `Use ${r.resolved}`;
          use.onclick = () => select({ ...hit, accession: r.resolved, hasAlphaFold: true,
                                       resolvedFrom: hit.accession, resolveNote: r.note ?? "" });
          note.appendChild(use);
        } else {
          note.textContent = `${r?.note ?? "No reviewed entry with an AlphaFold model was found."} Upload a custom structure below to run anyway.`;
          root.querySelector<HTMLDetailsElement>("details.advanced")!.open = true;
        }
      }).catch(() => {
        if (g === gen) note.textContent = "Could not check for a reviewed entry (network error).";
      });
    }

    // Cache probe: results already on disk => offer "View results" (no POST).
    let cached = false;
    fetchScore(hit.accession)
      .then(() => { cached = true; btn.textContent = "View results"; })
      .catch(() => { /* not cached — keep "Run prediction" */ });
    btn.onclick = async () => {
      if (cached) { onDone(hit.accession); return; }
      const g = gen;
      btn.disabled = true;
      progress.hidden = false;
      progress.textContent = `Running prediction for ${hit.accession}… this can take several minutes.`;
      const nterm = root.querySelector<HTMLInputElement>(".nterm")!.value;
      const file = root.querySelector<HTMLInputElement>(".cif")!.files?.[0] ?? null;
      try {
        const { job_id } = await runPrediction(hit.accession, nterm ? Number(nterm) : null, file);
        if (g !== gen) return; // cleared or re-selected while POSTing
        poll(job_id, hit.accession, g);
      } catch (e) {
        if (g !== gen) return; // cleared or re-selected mid-request: no callbacks
        btn.disabled = false;
        if (e instanceof ApiError && e.status === 503) {
          // Reference data still downloading: keep the panel usable, show why.
          progress.textContent = e.message;
        } else {
          progress.hidden = true;
          onError(hit.accession, e instanceof Error ? e.message : String(e));
        }
      }
    };
  }

  return {
    select,
    clear(): void {
      gen += 1;
      if (timer) clearTimeout(timer);
      root.innerHTML = "";
    },
  };
}
