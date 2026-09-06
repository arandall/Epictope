import { describe, it, expect } from "vitest";
import { topSites, movingAverage } from "../src/chart";

describe("topSites", () => {
  it("returns the single highest peak", () => {
    const rows = [{ position: 1, min: 0.1 }, { position: 2, min: 0.9 }, { position: 3, min: 0.5 }];
    expect(topSites(rows as any, 1).map(s => s.position)).toEqual([2]);
  });
  it("detects distinct local maxima, not adjacent residues", () => {
    const rows = [
      { position: 1, min: 0.1 }, { position: 2, min: 0.9 }, { position: 3, min: 0.8 },
      { position: 4, min: 0.2 }, { position: 5, min: 0.85 }, { position: 6, min: 0.7 },
    ];
    // peaks at 2 (0.9) and 5 (0.85); position 3 is not a peak
    expect(topSites(rows as any, 2).map(s => s.position)).toEqual([2, 5]);
  });
});

describe("movingAverage", () => {
  it("averages within a centered window", () => {
    const rows = [1, 2, 3, 4, 5].map((x, i) => ({ position: i + 1, min: x }));
    expect(movingAverage(rows as any, "min", 3)[2]).toBeCloseTo(3); // mean(2,3,4)
  });
});
