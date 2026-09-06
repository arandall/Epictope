import { describe, it, expect } from "vitest";
import { colorForColumn, queryPositions } from "../src/msa";
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
