import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchScore, fetchJob, fetchMsa, fetchInfo, ApiError } from "../src/api";

const nonOk = (status: number, detail: string) => ({
  ok: false,
  status,
  json: async () => ({ detail }),
});
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

describe("api result endpoints", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetchScore rejects with an ApiError carrying the server detail on non-ok", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => nonOk(404, "no score result for this ID")));
    let err: unknown;
    try {
      await fetchScore("X");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(404);
    expect((err as ApiError).message).toContain("no score result for this ID");
  });

  it("fetchJob, fetchMsa, and fetchInfo reject with an ApiError on non-ok", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => nonOk(404, "not found")));
    await expect(fetchJob("j")).rejects.toBeInstanceOf(ApiError);
    await expect(fetchMsa("m")).rejects.toBeInstanceOf(ApiError);
    await expect(fetchInfo("i")).rejects.toBeInstanceOf(ApiError);
  });

  it("the result endpoints resolve the parsed body on ok", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok({ status: "done" })));
    await expect(fetchJob("j")).resolves.toEqual({ status: "done" });
    await expect(fetchInfo("i")).resolves.toEqual({ status: "done" });
  });
});
