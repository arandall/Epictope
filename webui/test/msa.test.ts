// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { colorForColumn, queryPositions, colorRuns, renderMsa } from "../src/msa";
describe("colorForColumn", () => {
  it("red when all identical", () => expect(colorForColumn(["A","A","A"],0)).toBe("red"));
  it("blue when differing", () => expect(colorForColumn(["A","C","A"],0)).toBe("blue"));
  it("yellow when gap present", () => expect(colorForColumn(["A","-","A"],0)).toBe("yellow"));
});
describe("queryPositions", () => {
  it("maps gap-containing query columns to residue numbers", () => {
    const msa = { query: "A", records: [{ id: "A", seq: "A-C" }] };
    expect(queryPositions(msa as any)).toEqual([1, null, 2]);
  });
});
describe("colorRuns", () => {
  it("merges consecutive same-colored columns into one run", () => {
    // cols 0-1 red (all A), col 2 yellow (gap in row 0), cols 3-4 blue (differ, no gaps)
    const seqs = ["AA-AA", "AACCB", "AABCG"];
    const runs = colorRuns(seqs, 0);
    expect(runs).toEqual([
      { color: "red", text: "AA" },
      { color: "yellow", text: "-" },
      { color: "blue", text: "AA" },
    ]);
  });
  it("keeps row text identical to the input sequence", () => {
    const seqs = ["AC-DE", "ACADE", "AC-DE"];
    for (let r = 0; r < seqs.length; r++) {
      expect(colorRuns(seqs, r).map(x => x.text).join("")).toBe(seqs[r]);
    }
  });
  it("handles an all-identical row as a single run", () => {
    expect(colorRuns(["MMM", "MMM"], 1)).toEqual([{ color: "red", text: "MMM" }]);
  });
  it("renderMsa prepends a ruler marking every 10 columns", () => {
    document.body.innerHTML = "";
    const el = document.createElement("div");
    document.body.appendChild(el);
    const seq = "ACDEFGHIKLMNPQRSTVWY"; // 20 columns
    renderMsa(el, { query: "Q", records: [{ id: "Q", seq }, { id: "H", seq }] });
    const ruler = el.querySelector(".msaruler")!;
    expect(ruler).not.toBeNull();
    // labels right-aligned on their column: "10" ends at col 10, "20" at col 20
    expect(ruler.textContent).toContain("10");
    expect(ruler.textContent).toContain("20");
    // tick line: "|" at every 10th column
    const tick = ruler.textContent!.split("\n")[1];
    expect(tick[9]).toBe("|");
    expect(tick[19]).toBe("|");
    expect(tick[0]).toBe(" ");
  });
});
