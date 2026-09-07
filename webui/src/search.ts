import { fetchSearch } from "./api";

export interface SearchHit {
  accession: string; gene: string; organism: string;
  reviewed: boolean; hasAlphaFold: boolean;
}

export function mountSearch(root: HTMLElement, onSelect: (hit: SearchHit) => void): void {
  root.innerHTML = `
    <div class="searchbox">
      <input type="search" placeholder="Gene, accession, or organism — e.g. smad5 or Q9W7E7"
             aria-label="Search UniProt" autocomplete="off" spellcheck="false"/>
    </div>`;
  const input = root.querySelector("input")!;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let reqId = 0;
  let active = -1;
  let hits: SearchHit[] = [];

  const close = () => { root.querySelector("[role=listbox]")?.remove(); active = -1; };

  const open = (items: SearchHit[], q: string) => {
    close();
    hits = items;
    const ul = document.createElement("ul");
    ul.setAttribute("role", "listbox");
    ul.className = "autocomplete";
    if (items.length === 0) {
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = `No UniProt entries match '${q}'`;
      ul.appendChild(li);
    } else {
      items.forEach((h, i) => {
        const li = document.createElement("li");
        li.setAttribute("role", "option");
        li.innerHTML = `<b>${h.accession}</b> ${h.gene} <span class="org">${h.organism}</span>
          ${h.reviewed ? '<span class="tag">reviewed</span>' : ""}
          ${h.hasAlphaFold ? '<span class="tag">AlphaFold</span>' : ""}`;
        li.addEventListener("click", () => { onSelect(h); close(); });
        li.dataset.index = String(i);
        ul.appendChild(li);
      });
    }
    root.querySelector(".searchbox")!.appendChild(ul);
  };

  const markActive = () => {
    root.querySelectorAll("[role=option]").forEach((li, i) =>
      li.classList.toggle("active", i === active));
  };

  input.addEventListener("input", () => {
    if (timer) clearTimeout(timer);
    const q = input.value.trim();
    if (!q) { close(); return; }
    const id = ++reqId;
    timer = setTimeout(async () => {
      const rows: SearchHit[] = await fetchSearch(q);
      if (id !== reqId) return; // a newer query superseded this one
      open(rows, q);
    }, 300);
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { close(); return; }
    if (!hits.length) return;
    if (e.key === "ArrowDown") { active = Math.min(hits.length - 1, active + 1); markActive(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { active = Math.max(0, active - 1); markActive(); e.preventDefault(); }
    else if (e.key === "Enter" && active >= 0) { onSelect(hits[active]); close(); e.preventDefault(); }
  });
}
