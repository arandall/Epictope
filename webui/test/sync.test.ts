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
  it("notifies marked listeners on setMarked", () => {
    let got: number | null = -1;
    const off = bus.onMarked(p => { got = p; });
    bus.setMarked(7);
    expect(got).toBe(7);
    bus.setMarked(null);
    expect(got).toBeNull();
    off();
  });
});
