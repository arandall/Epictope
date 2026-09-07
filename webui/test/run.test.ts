// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mountRunPanel } from "../src/run";
import { ApiError, fetchJob } from "../src/api";

const jobs: Record<string, { status: string }> = { "job-1": { status: "running" } };
let runMock = vi.fn(async () => ({ job_id: "job-1" }));
let scoreMock = vi.fn(async () => { const e = new Error("404"); throw e; }); // default: not cached
vi.mock("../src/api", () => ({
  ApiError: class extends Error { constructor(public status: number, m: string) { super(m); } },
  runPrediction: (...a: any[]) => runMock(...a),
  fetchScore: (...a: any[]) => scoreMock(...a),
  fetchJob: vi.fn(async (id: string) => {
    // first poll: running; second poll: done
    const j = jobs[id];
    if (j.status === "running") { jobs["job-1"] = { status: "done" }; }
    return j;
  }),
}));

const hit = { accession: "Q9W7E7", gene: "smad5", organism: "Danio rerio", reviewed: true, hasAlphaFold: true };

describe("mountRunPanel", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
    jobs["job-1"] = { status: "running" };
    runMock = vi.fn(async () => ({ job_id: "job-1" }));
    scoreMock = vi.fn(async () => { throw new Error("404"); });
  });

  it("renders the selected card with a collapsed advanced disclosure", () => {
    const root = document.createElement("div");
    const panel = mountRunPanel(root, vi.fn(), vi.fn());
    panel.select(hit);
    expect(root.textContent).toContain("smad5");
    expect(root.textContent).toContain("Q9W7E7");
    const details = root.querySelector("details.advanced")!;
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
});
