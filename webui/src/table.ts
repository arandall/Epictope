import { bus } from "./sync";
export function renderTable(el: HTMLElement, rows: any[]) {
  const cols = Object.keys(rows[0]||{});
  el.innerHTML = `<input id="ftFilter" placeholder="filter..."/>
    <table class="ft"><thead><tr>${cols.map(c=>`<th>${c}</th>`).join("")}</tr></thead>
    <tbody></tbody></table>`;
  const tbody = el.querySelector("tbody")!;
  // Rows carry data-pos so the linked highlight survives filtering (index-based
  // mapping would point at the wrong residues after the tbody is re-drawn).
  const draw = (data:any[]) => { tbody.innerHTML = data.map(r=>
    `<tr data-pos="${r.position}">${cols.map(c=>`<td>${r[c]}</td>`).join("")}</tr>`).join(""); };
  draw(rows);
  (el.querySelector("#ftFilter") as HTMLInputElement).oninput = (e)=>{
    const v=(e.target as HTMLInputElement).value.toLowerCase();
    draw(rows.filter(r=>cols.some(c=>String(r[c]).toLowerCase().includes(v))));
  };
  bus.onActive(pos=>{
    tbody.querySelectorAll("tr[data-pos]").forEach(tr=>{
      (tr as HTMLElement).style.background =
        (pos!=null && Number((tr as HTMLElement).dataset.pos)===pos)?"#ffd166":"";
    });
  });
}
