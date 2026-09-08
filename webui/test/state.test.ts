// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { parseUrl, setUrl } from "../src/state";
import { parseChunk, DEFAULT_MSA_WRAP } from "../src/state";

describe("URL state", () => {
  it("parses ?id= from the location", () => {
    window.history.replaceState(null, "", "/?id=Q9W7E7");
    expect(parseUrl()).toBe("Q9W7E7");
  });
  it("returns null without ?id=", () => {
    window.history.replaceState(null, "", "/");
    expect(parseUrl()).toBeNull();
  });
  it("setUrl writes and clears ?id= without reloading", () => {
    window.history.replaceState(null, "", "/");
    setUrl("Q9W7E7");
    expect(window.location.search).toBe("?id=Q9W7E7");
    setUrl(null);
    expect(window.location.search).toBe("");
  });
  it("round-trips: setUrl then parseUrl", () => {
    setUrl("P57102");
    expect(parseUrl()).toBe("P57102");
    setUrl(null);
  });
});

describe("parseChunk", () => {
  it("defaults to 200 without the param", () => {
    window.history.replaceState(null, "", "/");
    expect(parseChunk()).toBe(DEFAULT_MSA_WRAP);
  });
  it("reads ?msa-chunk= and clamps to [40, 2000]", () => {
    window.history.replaceState(null, "", "/?msa-chunk=100");
    expect(parseChunk()).toBe(100);
    window.history.replaceState(null, "", "/?msa-chunk=5");
    expect(parseChunk()).toBe(40);
    window.history.replaceState(null, "", "/?msa-chunk=99999");
    expect(parseChunk()).toBe(2000);
    window.history.replaceState(null, "", "/?msa-chunk=abc");
    expect(parseChunk()).toBe(DEFAULT_MSA_WRAP);
  });
});
