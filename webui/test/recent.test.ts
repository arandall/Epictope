// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { loadRecent, pushRecent } from "../src/recent";

describe("recent searches", () => {
  beforeEach(() => localStorage.clear());
  it("starts empty and survives corrupt storage", () => {
    expect(loadRecent()).toEqual([]);
    localStorage.setItem("epictope.recentSearches", "{not json");
    expect(loadRecent()).toEqual([]);
  });
  it("prepends, dedupes by query, and caps at 10", () => {
    for (let i = 0; i < 12; i++) pushRecent({ q: `q${i}` });
    pushRecent({ q: "q5" }); // duplicate moves to front
    const list = loadRecent();
    expect(list).toHaveLength(10);
    expect(list[0].q).toBe("q5");
    expect(list[1].q).toBe("q11");
  });
});
