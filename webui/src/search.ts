import { fetchSearch, fetchResolve } from "./api";
import { loadRecent, pushRecent } from "./recent";

export interface SearchHit {
  accession: string; gene: string; organism: string; protein: string;
  reviewed: boolean; hasAlphaFold: boolean;
  resolvedFrom?: string;   // typed accession that resolved to this hit
  resolveNote?: string;
}

// Canonical UniProt accession pattern (Q5MD89, Q9W7E7, A0A2R8QSE0, P12345);
// gene names like smad5/flt4/TP53 do NOT match.
const ACC_RE = /^([OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9]([A-Z][A-Z0-9]{2}[0-9]){1,2})$/i;

// Accession list when EVERY whitespace/comma-separated token is an accession.
export function isAccessionQuery(q: string): string[] {
  const toks = q.split(/[\s,]+/).filter(Boolean);
  return toks.length > 0 && toks.every(t => ACC_RE.test(t)) ? toks : [];
}

// One accession: direct search + resolve, merged with the resolved hit first.
export async function accessionHits(acc: string): Promise<SearchHit[]> {
  const [direct, res] = await Promise.all([
    fetchSearch(acc).catch(() => [] as SearchHit[]),
    fetchResolve([acc]).then((r: any[]) => r[0]).catch(() => null),
  ]);
  const hits: SearchHit[] = [];
  if (res?.resolved && res.resolved.toUpperCase() !== acc.toUpperCase()) {
    const target = (await fetchSearch(res.resolved).catch(() => [] as SearchHit[]))
      .find((h: SearchHit) => h.accession === res.resolved);
    hits.push({
      ...(target ?? { accession: res.resolved, gene: "", organism: "", protein: "",
                      reviewed: true, hasAlphaFold: !!res.af_id }),
      resolvedFrom: acc,
      resolveNote: res.note ?? "",
    });
  }
  hits.push(...direct);
  return hits;
}

export async function runQuery(q: string): Promise<SearchHit[]> {
  const accs = isAccessionQuery(q);
  if (!accs.length) return fetchSearch(q);
  const per = await Promise.all(accs.map(accessionHits));
  const seen = new Set<string>();
  const out: SearchHit[] = [];
  for (const h of per.flat()) {
    const key = h.resolvedFrom ? `${h.accession}<-${h.resolvedFrom}` : h.accession;
    if (!seen.has(key)) { seen.add(key); out.push(h); }
  }
  return out;
}

export function mountSearch(root: HTMLElement, onSelect: (hit: SearchHit) => void): void {
  root.innerHTML = `
    <div class="searchbox">
      <div class="searchrow">
        <input type="search" placeholder="Gene, accession, or organism — e.g. smad5 or Q9W7E7"
               aria-label="Search UniProt" autocomplete="off" spellcheck="false"/>
      </div>
      <button class="primary searchbtn" type="button">Search</button>
    </div>
    <div class="recent" hidden></div>`;
  const input = root.querySelector("input")!;
  const btn = root.querySelector<HTMLButtonElement>(".searchbtn")!;
  const recentEl = root.querySelector<HTMLElement>(".recent")!;
  let reqId = 0;
  let active = -1;
  let hits: SearchHit[] = [];

  const close = () => { root.querySelector("[role=listbox]")?.remove(); active = -1; hits = []; };

  const open = (items: SearchHit[], q: string, loading = false) => {
    close();
    hits = items;
    const ul = document.createElement("ul");
    ul.setAttribute("role", "listbox");
    ul.className = "autocomplete";
    if (loading) {
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = `Searching UniProt for '${q}'…`;
      ul.appendChild(li);
    } else if (items.length === 0) {
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = `No UniProt entries match '${q}'`;
      ul.appendChild(li);
    } else {
      items.forEach((h, i) => {
        const li = document.createElement("li");
        li.setAttribute("role", "option");
        li.innerHTML = `<b>${h.accession}</b> ${h.gene} <span class="org">${h.organism}</span>
          ${h.protein ? `<span class="prot">${h.protein}</span>` : ""}
          ${h.reviewed ? '<span class="tag">reviewed</span>' : ""}
          ${h.hasAlphaFold ? '<span class="tag">AlphaFold</span>' : '<span class="tag warn">no AlphaFold</span>'}
          ${h.resolvedFrom ? `<span class="tag resolved">from ${h.resolvedFrom}</span>` : ""}`;
        li.addEventListener("click", () => { onSelect(h); close(); });
        li.dataset.index = String(i);
        ul.appendChild(li);
      });
    }
    root.querySelector(".searchrow")!.appendChild(ul);
  };

  const renderRecent = () => {
    const list = loadRecent();
    recentEl.hidden = list.length === 0;
    recentEl.innerHTML = list.length ? `<span class="recentlabel">Recent:</span>` : "";
    list.forEach(e => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = e.q;
      b.addEventListener("click", () => { input.value = e.q; submit(); });
      recentEl.appendChild(b);
    });
  };
  renderRecent();

  const submit = async () => {
    const q = input.value.trim();
    if (!q) { close(); return; }
    const id = ++reqId;
    open([], q, true);
    const rows = await runQuery(q).catch(() => [] as SearchHit[]);
    if (id !== reqId) return; // a newer search superseded this one
    pushRecent({ q });
    renderRecent();
    open(rows, q);
  };

  btn.addEventListener("click", submit);

  const markActive = () => {
    root.querySelectorAll("[role=option]").forEach((li, i) =>
      li.classList.toggle("active", i === active));
  };

  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { close(); return; }
    if (e.key === "ArrowDown" && hits.length) { active = Math.min(hits.length - 1, active + 1); markActive(); e.preventDefault(); return; }
    if (e.key === "ArrowUp" && hits.length) { active = Math.max(0, active - 1); markActive(); e.preventDefault(); return; }
    if (e.key === "Enter") {
      if (active >= 0 && hits[active]) { onSelect(hits[active]); close(); }
      else submit();
      e.preventDefault();
    }
  });
}
