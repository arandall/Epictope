// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mountRunPanel } from "../src/run";
import { ApiError, fetchJob } from "../src/api";

const jobs: Record<string, { status: string }> = { "job-1": { status: "running" } };
// vitest 1.5 Mock instances are not mutually assignable across reassignment
// (this-typed methods), so the swappable mocks are typed loosely on purpose.
let runMock: any = vi.fn(async () => ({ job_id: "job-1" }));
let scoreMock: any = vi.fn(async () => { const e = new Error("404"); throw e; }); // default: not cached
let resolveMock: any = vi.fn(async () => [{ input: "X", resolved: null, note: "no reviewed entry found" }]);
vi.mock("../src/api", () => ({
  ApiError: class extends Error { constructor(public status: number, m: string) { super(m); } },
  runPrediction: (...a: any[]) => runMock(...a),
  fetchScore: (...a: any[]) => scoreMock(...a),
  fetchResolve: (...a: any[]) => resolveMock(...a),
  fetchJob: vi.fn(async (id: string) => {
    // first poll: running; second poll: done
    const j = jobs[id];
    if (j.status === "running") { jobs["job-1"] = { status: "done" }; }
    return j;
  }),
}));

const hit = { accession: "Q9W7E7", gene: "smad5", organism: "Danio rerio", protein: "", reviewed: true, hasAlphaFold: true };

describe("mountRunPanel", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
    jobs["job-1"] = { status: "running" };
    runMock = vi.fn(async () => ({ job_id: "job-1" }));
    scoreMock = vi.fn(async () => { throw new Error("404"); });
    resolveMock = vi.fn(async () => [{ input: "X", resolved: null, note: "no reviewed entry found" }]);
  });

  it("renders the selected card with a collapsed advanced disclosure", () => {
    const root = document.createElement("div");
    const panel = mountRunPanel(root, vi.fn(), vi.fn());
    panel.select(hit);
    expect(root.textContent).toContain("smad5");
    expect(root.textContent).toContain("Q9W7E7");
    const details = root.querySelector<HTMLDetailsElement>("details.advanced")!;
    expect(details.open).toBe(false);
    expect(details.textContent).toContain("optional");
    expect((root.querySelector("button.primary") as HTMLButtonElement).textContent).toContain("Run prediction");
  });

  it("labels the button 'View results' when results are cached, and skips POST", async () => {
    scoreMock = vi.fn(async () => [{ position: 1 }]); // cache hit
    const root = document.createElement("div");
    const onDone = vi.fn();
    const panel = mountRunPanel(root, onDone, vi.fn());
    panel.select(hit);
    await vi.advanceTimersByTimeAsync(0); // let the cache probe resolve
    const btn = root.querySelector("button.primary") as HTMLButtonElement;
    expect(btn.textContent).toContain("View results");
    btn.click();
    expect(onDone).toHaveBeenCalledWith("Q9W7E7");
    expect(runMock).not.toHaveBeenCalled();
  });

  it("runs, polls, and calls onDone when the job completes", async () => {
    const root = document.createElement("div");
    const onDone = vi.fn();
    const panel = mountRunPanel(root, onDone, vi.fn());
    panel.select(hit);
    (root.querySelector("button.primary") as HTMLButtonElement).click();
    await vi.advanceTimersByTimeAsync(0);      // let runPrediction resolve
    await vi.advanceTimersByTimeAsync(1600);   // first poll -> running
    await vi.advanceTimersByTimeAsync(1600);   // second poll -> done
    expect(onDone).toHaveBeenCalledWith("Q9W7E7");
  });

  it("a 503 from /api/run re-enables the button and shows the detail, no onError", async () => {
    runMock = vi.fn(async () => { throw new ApiError(503, "reference data is still downloading; try again soon"); });
    const root = document.createElement("div");
    const onError = vi.fn();
    const panel = mountRunPanel(root, vi.fn(), onError);
    panel.select(hit);
    const btn = root.querySelector("button.primary") as HTMLButtonElement;
    btn.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(onError).not.toHaveBeenCalled();
    expect(btn.disabled).toBe(false);
    expect(root.querySelector(".progress")!.textContent).toContain("still downloading");
  });

  it("offers the resolved reviewed accession when the hit has no AlphaFold model", async () => {
    resolveMock = vi.fn(async () => [{ input: "A0A2R8QSE0", resolved: "Q5MD89", af_id: "Q5MD89",
      note: "resolved to reviewed ortholog (gene=flt4)" }]);
    const root = document.createElement("div");
    const panel = mountRunPanel(root, vi.fn(), vi.fn());
    panel.select({ ...hit, accession: "A0A2R8QSE0", hasAlphaFold: false });
    await vi.advanceTimersByTimeAsync(0);
    const use = root.querySelector<HTMLButtonElement>("button.useresolved");
    expect(use?.textContent).toContain("Q5MD89");
    expect(root.querySelector(".resolve-note")!.textContent).toContain("reviewed ortholog");
    use!.click();
    await vi.advanceTimersByTimeAsync(0); // re-select + cache probe settle
    expect(root.querySelector(".selmain")!.textContent).toContain("Q5MD89");
    expect(root.querySelector(".resolve-note")!.textContent).toContain("A0A2R8QSE0");
  });

  it("points at the custom-structure upload when nothing resolves", async () => {
    const root = document.createElement("div");
    const panel = mountRunPanel(root, vi.fn(), vi.fn());
    panel.select({ ...hit, accession: "A0A0R4IFS9", hasAlphaFold: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(root.querySelector(".resolve-note")!.textContent).toContain("custom structure");
    expect(root.querySelector<HTMLDetailsElement>("details.advanced")!.open).toBe(true);
  });

  it("clear() empties the panel", () => {
    const root = document.createElement("div");
    const panel = mountRunPanel(root, vi.fn(), vi.fn());
    panel.select(hit);
    panel.clear();
    expect(root.innerHTML).toBe("");
  });

  it("stops the poll chain and fires no callbacks after clear() while a poll is in flight", async () => {
    const onDone = vi.fn();
    const onError = vi.fn();
    let release!: (v: { status: string }) => void;
    const gated = new Promise<{ status: string }>((res) => { release = res; });
    vi.mocked(fetchJob).mockImplementationOnce(() => gated);
    const root = document.createElement("div");
    const panel = mountRunPanel(root, onDone, onError);
    panel.select(hit);
    (root.querySelector("button.primary") as HTMLButtonElement).click();
    await vi.advanceTimersByTimeAsync(0);     // runPrediction resolves, poll timer armed
    await vi.advanceTimersByTimeAsync(1600);  // poll timer fires, fetchJob await parked on gated
    panel.clear();                            // panel torn down mid-await
    release({ status: "done" });              // poll callback resumes after teardown
    await vi.advanceTimersByTimeAsync(10000); // ample time for any re-arm or callback
    expect(onDone).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("retries transient poll failures, then reports lost contact via onError", async () => {
    // Last test in the file on purpose: this permanent impl must not leak.
    vi.mocked(fetchJob).mockRejectedValue(new Error("network down"));
    const root = document.createElement("div");
    const onError = vi.fn();
    const panel = mountRunPanel(root, vi.fn(), onError);
    panel.select(hit);
    (root.querySelector("button.primary") as HTMLButtonElement).click();
    await vi.advanceTimersByTimeAsync(0);         // runPrediction resolves, first poll armed
    await vi.advanceTimersByTimeAsync(5 * 1600);  // five consecutive failed polls (1500 ms apart)
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith("Q9W7E7", "lost contact with the server while running the prediction");
  });

  it("fires no onError after clear() while a failing poll is in flight", async () => {
    let reject!: (e: Error) => void;
    const gated = new Promise<never>((_, rej) => { reject = rej; });
    vi.mocked(fetchJob).mockImplementationOnce(() => gated);
    const root = document.createElement("div");
    const onError = vi.fn();
    const panel = mountRunPanel(root, vi.fn(), onError);
    panel.select(hit);
    (root.querySelector("button.primary") as HTMLButtonElement).click();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1600); // poll timer fires, fetchJob parked on gated rejection
    panel.clear();
    reject(new Error("network down"));       // failure lands after teardown
    await vi.advanceTimersByTimeAsync(10000);
    expect(onError).not.toHaveBeenCalled();
  });
});
