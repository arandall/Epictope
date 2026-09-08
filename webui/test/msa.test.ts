// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { colorForColumn, queryPositions, colorRuns, renderMsa, baseName, rulerFor } from "../src/msa";
import { bus } from "../src/sync";
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
});

describe("baseName", () => {
  it("strips directory paths from record ids", () => {
    expect(baseName("data/CDS/Bos_taurus.ARS-UCD1.2.pep.all.fa")).toBe("Bos_taurus.ARS-UCD1.2.pep.all.fa");
    expect(baseName("Q5MD89")).toBe("Q5MD89");
    expect(baseName("a\\b\\c.fa")).toBe("c.fa");
  });
});

describe("rulerFor", () => {
  it("labels multiples of 10 right-aligned on their absolute column", () => {
    const r = rulerFor(0, 20);
    const [label, tick] = r.split("\n");
    expect(tick[9]).toBe("|");
    expect(tick[19]).toBe("|");
    expect(tick[0]).toBe(" ");
    expect(label.slice(8, 10)).toBe("10");  // "10" ends at column 10
    expect(label.slice(18, 20)).toBe("20");
  });
  it("uses absolute columns for later chunks", () => {
    const [, tick] = rulerFor(190, 20).split("\n");
    expect(tick[9]).toBe("|");               // column 200 is a tick
    expect(rulerFor(190, 20).split("\n")[0].slice(7, 10)).toBe("200");
  });

  it("places a down arrow on the tick line and the column number above it", () => {
    const [label, tick] = rulerFor(40, 20, 45).split("\n"); // absolute column 46
    expect(tick[5]).toBe("▼");
    expect(label.slice(4, 6)).toBe("46");
    expect(label).toHaveLength(20);
    expect(tick).toHaveLength(20);
  });
  it("keeps other ticks and labels intact when marking", () => {
    const [label, tick] = rulerFor(0, 20, 4).split("\n");
    expect(tick[9]).toBe("|");
    expect(label.slice(8, 10)).toBe("10");
    expect(tick[4]).toBe("▼");
    expect(label.slice(3, 5)).toBe(" 5");
  });
  it("replaces the tick under a numbered column with the arrow", () => {
    const [label, tick] = rulerFor(0, 20, 9).split("\n"); // column 10
    expect(tick[9]).toBe("▼");
    expect(label.slice(8, 10)).toBe("10");
  });
  it("ignores a mark outside the chunk", () => {
    expect(rulerFor(0, 20, 20)).toBe(rulerFor(0, 20));
  });
});

describe("renderMsa", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  function mountMsa(seqs: { id: string; seq: string }[], query: string, wrap?: number) {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const onPositionClick = vi.fn();
    const handle = renderMsa(el, { query, records: seqs }, { wrap, onPositionClick });
    return { el, handle, onPositionClick };
  }

  it("splits into chunks of `wrap` columns with one ruler and one row set per chunk", () => {
    const seq = "A".repeat(45);
    const { el } = mountMsa([{ id: "Q", seq }, { id: "H", seq }], "Q", 20);
    const chunks = el.querySelectorAll(".msachunk");
    expect(chunks).toHaveLength(3); // 20 + 20 + 5
    expect(el.querySelectorAll(".msaruler")).toHaveLength(3);
    // one letter = one position: every chunk row has one .cell per column
    const firstBlockRows = chunks[0].querySelectorAll(".msablock .msarow");
    const firstSeqRow = firstBlockRows[1]; // row 0 is the ruler
    expect(firstSeqRow.querySelectorAll(".cell")).toHaveLength(20);
    expect(chunks[2].querySelectorAll(".msarow")[1].querySelectorAll(".cell")).toHaveLength(5);
    expect(chunks[0].querySelector(".chunkhead")!.textContent).toContain("1–20");
  });

  it("renders row labels as basenames and flags the query row", () => {
    const { el } = mountMsa([
      { id: "data/CDS/Bos_taurus.pep.all.fa", seq: "AAAA" },
      { id: "Q5MD89", seq: "AAAA" },
    ], "Q5MD89", 200);
    const names = Array.from(el.querySelectorAll(".msaname")).map(n => n.textContent);
    expect(names).toContain("Bos_taurus.pep.all.fa");
    expect(names).toContain("Q5MD89");
    expect(names.some(n => n?.includes("data/CDS"))).toBe(false);
    expect(el.querySelector(".msaname.isquery")!.textContent).toBe("Q5MD89");
  });

  it("pins the query row directly under the ruler in every chunk", () => {
    const seq = "A".repeat(45);
    const { el } = mountMsa([
      { id: "H1", seq }, { id: "H2", seq }, { id: "Q", seq }, { id: "H3", seq },
    ], "Q", 20);
    expect(el.querySelectorAll(".msachunk")).toHaveLength(3);
    el.querySelectorAll(".msachunk").forEach(chunk => {
      const rows = chunk.querySelectorAll(".msablock .msarow");
      expect(rows[1].classList.contains("queryrow")).toBe(true); // row 0 is the ruler
      expect(rows[1].querySelector(".msaname")!.textContent).toBe("Q");
    });
  });

  it("hovering a cell sets the active query residue and shows the tooltip at the mouse", () => {
    const { el } = mountMsa([{ id: "Q", seq: "ACDEFGHIKL" }, { id: "M", seq: "MCDEFGHIKL" }], "Q");
    const setActive = vi.spyOn(bus, "setActive").mockImplementation(() => {});
    const strip = el.querySelectorAll(".msarow")[1].querySelector(".msastrip")!;
    const cell = strip.querySelectorAll<HTMLElement>(".cell")[5];
    cell.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 50, clientY: 60 }));
    expect(setActive).toHaveBeenCalledWith(6); // gapless query: col 5 -> residue 6
    const tip = el.querySelector<HTMLElement>(".msatip")!;
    expect(tip.hidden).toBe(false);
    expect(tip.style.left).toBe("62px"); // clientX + 12
    strip.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));
    expect(tip.hidden).toBe(true);
    expect(setActive).toHaveBeenLastCalledWith(null);
    vi.restoreAllMocks();
  });

  it("hovering a cell greys its whole contiguous colour run", () => {
    // cols 0-1 red (all A), col 2 yellow (gap in Q), cols 3-4 blue — same
    // fixture as the colorRuns test above.
    const { el } = mountMsa([
      { id: "Q", seq: "AA-AA" },
      { id: "H", seq: "AACCB" },
      { id: "G", seq: "AABCG" },
    ], "Q");
    const strip = el.querySelectorAll(".msarow")[1].querySelector(".msastrip")!;
    const cells = strip.querySelectorAll<HTMLElement>(".cell");
    cells[0].dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 0, clientY: 0 }));
    const ranged = Array.from(strip.querySelectorAll(".cell.inrange"));
    expect(ranged.map(c => (c as HTMLElement).dataset.col)).toEqual(["0", "1"]);
    strip.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));
    expect(strip.querySelectorAll(".cell.inrange")).toHaveLength(0);
  });

  it("clicking a cell reports the query position via onPositionClick", () => {
    const { el, onPositionClick } = mountMsa([{ id: "Q", seq: "A-CDEF" }, { id: "M", seq: "AACDEF" }], "Q");
    const strip = el.querySelectorAll(".msarow")[1].querySelector(".msastrip")!;
    strip.querySelectorAll<HTMLElement>(".cell")[2].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onPositionClick).toHaveBeenCalledWith(2); // col 2 in "A-CDEF" is residue 2
    strip.querySelectorAll<HTMLElement>(".cell")[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onPositionClick).toHaveBeenCalledWith(null); // gap column
  });

  it("markPosition highlights the matching column in every chunk row and clears on null", () => {
    const { el, handle } = mountMsa([{ id: "Q", seq: "ACDEF" }, { id: "M", seq: "ACDEF" }], "Q", 3);
    handle.markPosition(2); // residue 2 -> column 1
    expect(el.querySelectorAll(".cell.marked")).toHaveLength(2); // one per record row
    expect(el.querySelector(".cell.marked")!.getAttribute("data-col")).toBe("1");
    handle.markPosition(null);
    expect(el.querySelectorAll(".cell.marked")).toHaveLength(0);
  });

  it("markPosition draws the arrow + column number in the owning chunk's ruler only", () => {
    const { el, handle } = mountMsa([{ id: "Q", seq: "ACDEFG" }, { id: "M", seq: "ACDEFG" }], "Q", 4);
    handle.markPosition(5); // residue 5 -> column 4 -> second chunk (columns 5–6)
    const chunks = el.querySelectorAll(".msachunk");
    expect(chunks[0].querySelectorAll(".rulermark")).toHaveLength(0);
    expect(chunks[0].querySelector(".msaruler")!.textContent).toBe(rulerFor(0, 4));
    // two .rulermark spans: the column number on the label line, "▼" on the tick line
    const marks = chunks[1].querySelectorAll(".rulermark");
    expect(marks).toHaveLength(2);
    expect(marks[0].textContent).toBe("5"); // absolute alignment column
    expect(marks[1].textContent).toBe("▼");
    // ruler text (incl. the two-line layout) is unchanged by the spans
    expect(chunks[1].querySelector(".msaruler")!.textContent).toBe(rulerFor(4, 2, 4));
  });

  it("markPosition(null) restores the plain rulers", () => {
    const { el, handle } = mountMsa([{ id: "Q", seq: "ACDEFG" }, { id: "M", seq: "ACDEFG" }], "Q", 4);
    handle.markPosition(5);
    handle.markPosition(null);
    expect(el.querySelectorAll(".rulermark")).toHaveLength(0);
    const rulers = el.querySelectorAll(".msaruler");
    expect(rulers[0].textContent).toBe(rulerFor(0, 4));
    expect(rulers[1].textContent).toBe(rulerFor(4, 2));
  });

  it("scrollToPosition scrolls the owning chunk into view", () => {
    const scrollIntoView = vi.fn();
    const orig = Element.prototype.scrollIntoView; // undefined in jsdom
    Element.prototype.scrollIntoView = scrollIntoView;
    const seq = "A".repeat(50);
    const { handle } = mountMsa([{ id: "Q", seq }, { id: "M", seq }], "Q", 20);
    handle.scrollToPosition(45); // residue 45 -> column 44 -> chunk 2 (40-49)
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    Element.prototype.scrollIntoView = orig;
  });
});
