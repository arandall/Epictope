// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderSequence } from "../src/sequence";
import { bus } from "../src/sync";

const rows = [
  { position: 1, aa: "A" },
  { position: 2, aa: "C" },
  { position: 3, aa: "D" },
  { position: 4, aa: "E" },
];
const msa = { query: "Q", records: [{ id: "Q", seq: "AC-DE" }, { id: "H", seq: "ACADE" }] };

beforeEach(() => { document.body.innerHTML = ""; });

describe("renderSequence aligned to the MSA", () => {
  it("renders the gapped query chunked to wrap columns with one span per column", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    renderSequence(el, rows, { msa, wrap: 4 });
    const chunks = el.querySelectorAll(".seqchunk");
    expect(chunks).toHaveLength(2); // 4 + 1 columns
    const first = chunks[0].querySelectorAll(".res");
    expect(first).toHaveLength(4); // includes the gap column
    expect(chunks[0].querySelectorAll(".res.gap")).toHaveLength(1); // column 2
    expect((first[3] as HTMLElement).dataset.pos).toBe("3"); // gap skipped in numbering
  });
  it("hover marks the active residue, shows a tooltip at the mouse; click reports the position; bus.onMarked marks it", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const onPositionClick = vi.fn();
    renderSequence(el, rows, { msa, wrap: 200, onPositionClick });
    const setActive = vi.spyOn(bus, "setActive").mockImplementation(() => {});
    const res = el.querySelectorAll<HTMLElement>(".res:not(.gap)");
    res[1].dispatchEvent(new MouseEvent("mouseover", { bubbles: true, clientX: 30, clientY: 40 }));
    expect(setActive).toHaveBeenCalledWith(2);
    const tip = el.querySelector<HTMLElement>(".msatip")!;
    expect(tip.hidden).toBe(false);
    expect(tip.textContent).toContain("Position 2");
    expect(tip.style.left).toBe("42px"); // clientX + 12
    res[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onPositionClick).toHaveBeenCalledWith(2);
    bus.setMarked(2);
    expect(res[1].classList.contains("marked")).toBe(true);
    bus.setMarked(null);
    expect(res[1].classList.contains("marked")).toBe(false);
    vi.restoreAllMocks();
  });
  it("keeps the legacy flat strip when no msa is provided", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    renderSequence(el, rows);
    expect(el.querySelectorAll(".res")).toHaveLength(4);
    expect(el.querySelectorAll(".seqchunk")).toHaveLength(0);
  });
});
