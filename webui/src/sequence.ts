import { bus } from "./sync";
export function renderSequence(el: HTMLElement, rows: any[]) {
  el.innerHTML = "";
  const wrap = document.createElement("div"); wrap.className = "seqstrip";
  rows.forEach(r => {
    const s = document.createElement("span");
    s.className = "res"; s.dataset.pos = String(r.position); s.textContent = r.aa;
    s.onmouseenter = () => bus.setActive(Number(r.position));
    s.onmouseleave = () => bus.setActive(null);
    wrap.appendChild(s);
  });
  el.appendChild(wrap);
  bus.onActive(pos => {
    wrap.querySelectorAll(".res").forEach(n=>{
      (n as HTMLElement).classList.toggle("active", pos!=null && Number((n as HTMLElement).dataset.pos)===pos);
    });
  });
}
