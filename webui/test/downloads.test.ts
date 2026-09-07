// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { downloadScoreCsv, downloadMsaFasta, downloadChartPng, printResults } from "../src/downloads";

let clicks: string[];
beforeEach(() => {
  clicks = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    clicks.push(this.href);
  });
});

describe("downloads", () => {
  it("score CSV points at the streaming endpoint", () => {
    downloadScoreCsv("Q9W7E7");
    expect(clicks[0]).toContain("/api/results/Q9W7E7/score.csv");
  });
  it("MSA FASTA points at the streaming endpoint", () => {
    downloadMsaFasta("Q9W7E7");
    expect(clicks[0]).toContain("/api/results/Q9W7E7/msa.fasta");
  });
  it("chart PNG downloads a data URL named after the protein", () => {
    let downloadAttr = "";
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      downloadAttr = this.download;
    });
    const fakeChart = { toBase64Image: () => "data:image/png;base64,AAAA" };
    downloadChartPng(fakeChart, "Q9W7E7");
    expect(downloadAttr).toBe("Q9W7E7_min_score.png");
  });
  it("printResults calls window.print", () => {
    const spy = vi.spyOn(window, "print").mockImplementation(() => {});
    printResults();
    expect(spy).toHaveBeenCalled();
  });
});
