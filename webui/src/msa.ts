import { bus } from "./sync";
export type CellColor = "red"|"blue"|"yellow";
export function colorForColumn(seqs: string[], col: number): CellColor {
  const chars = seqs.map(s => s[col] ?? "-");
  if (chars.some(c => c === "-")) return "yellow";
  if (chars.every(c => c === chars[0])) return "red";
  return "blue";
}
// True query residue number per MSA column (counts non-gap chars in the query row),
// so hover links to the chart by real residue position even when gaps exist.
export function queryPositions(msa: { query: string; records: { id: string; seq: string }[] }): (number|null)[] {
  const q = (msa.records.find(r => r.id === msa.query) ?? msa.records[0])?.seq ?? "";
  let count = 0;
  return q.split("").map(ch => {
    if (ch === "-") return null;
    count += 1;
    return count;
  });
}
export function renderMsa(el: HTMLElement, msa: { query: string; records: { id: string; seq: string }[] }) {
  const seqs = msa.records.map(r => r.seq);
  const qpos = queryPositions(msa);
  el.innerHTML = "";
  const head = document.createElement("div"); head.className = "msahead";
  head.textContent = "MSA (red=conserved, blue=differs, yellow=gap) — hover links to chart by residue";
  el.appendChild(head);
  msa.records.forEach(rec => {
    const row = document.createElement("div"); row.className = "msarow";
    const name = document.createElement("span"); name.className="msaname"; name.textContent = rec.id;
    row.appendChild(name);
    const strip = document.createElement("span"); strip.className="msastrip";
    for (let c=0;c<rec.seq.length;c++){
      const s=document.createElement("span"); s.className=`cell ${colorForColumn(seqs,c)}`;
      s.dataset.pos=String(qpos[c] ?? ""); s.textContent=rec.seq[c];
      s.onmouseenter=()=>bus.setActive(qpos[c]); s.onmouseleave=()=>bus.setActive(null);
      strip.appendChild(s);
    }
    row.appendChild(strip); el.appendChild(row);
  });
  bus.onActive(pos => {
    el.querySelectorAll(".cell").forEach(n=>{
      const p=(n as HTMLElement).dataset.pos;
      (n as HTMLElement).classList.toggle("active", pos!=null && p!=="" && Number(p)===pos);
    });
  });
}
