import { bus } from "./sync";
export function renderInfo(el: HTMLElement, info: any) {
  el.innerHTML = `<h2>${info.uniprot_id} — ${info.gene||""}</h2>
    <p>${info.organism||""} · ${info.length} aa
       ${info.reviewed?"<span class=tag>reviewed</span>":""}
       ${info.hasAlphaFold?"<span class=tag>AlphaFold</span>":""}</p>
    ${info.resolution_note?`<p class=note>${info.resolution_note}</p>`:""}
    <h3>Top insertion sites</h3>
    <ul>${info.top_sites.map((s:any)=>`<li data-pos="${s.position}">${s.position}
       (min ${s.min}, limiting: ${s.min_feature})</li>`).join("")}</ul>`;
  el.querySelectorAll("li[data-pos]").forEach(li=>{
    (li as HTMLElement).onmouseenter=()=>bus.setActive(Number((li as HTMLElement).dataset.pos));
    (li as HTMLElement).onmouseleave=()=>bus.setActive(null);
  });
}
