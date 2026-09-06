import { describe, it, expect } from "vitest";
import { bus } from "../src/sync";
describe("sync bus", () => {
  it("notifies listeners on setActive", () => {
    let got: number | null = -1;
    bus.onActive(p => { got = p; });
    bus.setActive(42);
    expect(got).toBe(42);
    bus.setActive(null);
    expect(got).toBeNull();
  });
});
