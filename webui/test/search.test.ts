// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mountSearch, runQuery, isAccessionQuery, type SearchHit } from "../src/search";

const reviewedHit: SearchHit = { accession: "Q5MD89", gene: "flt4", organism: "Danio rerio",
  protein: "Vascular endothelial growth factor receptor 3", reviewed: true, hasAlphaFold: true };
const tremblHit: SearchHit = { accession: "A0A2R8QSE0", gene: "flt4", organism: "Danio rerio",
  protein: "", reviewed: false, hasAlphaFold: false };

let searchMock: any;
let resolveMock: any;
vi.mock("../src/api", () => ({
  fetchSearch: (...a: any[]) => searchMock(...a),
  fetchResolve: (...a: any[]) => resolveMock(...a),
}));
// NOTE: assert on searchMock/resolveMock, never on the re-imported fetchSearch —
// the mock factory exports plain arrow wrappers, which are not vi.fn instances.

function mount(onSelect = vi.fn()) {
  const root = document.createElement("div");
  document.body.appendChild(root);
  mountSearch(root, onSelect);
  return { root, onSelect,
           input: root.querySelector("input")!,
           button: root.querySelector<HTMLButtonElement>(".searchbtn")! };
}

describe("isAccessionQuery", () => {
  it("recognises UniProt accessions, not gene names", () => {
    expect(isAccessionQuery("A0A2R8QSE0")).toEqual(["A0A2R8QSE0"]);
    expect(isAccessionQuery("Q5MD89")).toEqual(["Q5MD89"]);
    expect(isAccessionQuery("smad5")).toEqual([]);
    expect(isAccessionQuery("TP53")).toEqual([]);
    expect(isAccessionQuery("A0A2R8QSE0, A0A0R4IFS9")).toEqual(["A0A2R8QSE0", "A0A0R4IFS9"]);
  });
});

describe("runQuery", () => {
  beforeEach(() => { searchMock = vi.fn(async () => []); resolveMock = vi.fn(async () => []); });
  it("plain terms go straight to /api/search", async () => {
    searchMock = vi.fn(async (q: string) => (q === "smad5" ? [reviewedHit] : []));
    expect(await runQuery("smad5")).toEqual([reviewedHit]);
    expect(resolveMock).not.toHaveBeenCalled();
  });
  it("an unreviewed accession also yields its resolved reviewed hit", async () => {
    searchMock = vi.fn(async (q: string) =>
      q === "A0A2R8QSE0" ? [tremblHit] : q === "Q5MD89" ? [reviewedHit] : []);
    resolveMock = vi.fn(async (accs: string[]) =>
      accs?.[0] === "A0A2R8QSE0"
        ? [{ input: "A0A2R8QSE0", resolved: "Q5MD89", af_id: "Q5MD89",
             note: "resolved to reviewed ortholog (gene=flt4)" }]
        : []);
    const hits = await runQuery("A0A2R8QSE0");
    expect(hits[0].accession).toBe("Q5MD89");
    expect(hits[0].resolvedFrom).toBe("A0A2R8QSE0");
    expect(hits[1].accession).toBe("A0A2R8QSE0");
  });
});

describe("mountSearch", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
    searchMock = vi.fn(async (q: string) => (q === "smad5" ? [reviewedHit] : []));
    resolveMock = vi.fn(async () => []);
  });

  it("does NOT search while typing; the button runs the search", async () => {
    const { root, input, button } = mount();
    input.value = "smad5";
    input.dispatchEvent(new Event("input"));
    expect(searchMock).not.toHaveBeenCalled();
    button.click();
    await vi.waitFor(() => expect(root.querySelectorAll("[role=option]")).toHaveLength(1));
    expect(searchMock).toHaveBeenCalledTimes(1);
    expect(root.textContent).toContain("Vascular endothelial growth factor receptor 3");
  });

  it("Enter in the input runs the search; Enter on a hit selects it", async () => {
    const { root, input, onSelect } = mount();
    input.value = "smad5";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    await vi.waitFor(() => expect(root.querySelectorAll("[role=option]")).toHaveLength(1));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(onSelect).toHaveBeenCalledWith(reviewedHit);
  });

  it("records the search in recent and renders a clickable recent chip", async () => {
    const { root, input, button } = mount();
    input.value = "smad5";
    button.click();
    await vi.waitFor(() => expect(root.querySelectorAll("[role=option]")).toHaveLength(1));
    const chip = root.querySelector<HTMLButtonElement>(".recent button");
    expect(chip?.textContent).toBe("smad5");
    searchMock.mockClear();
    chip!.click();
    await vi.waitFor(() => expect(searchMock).toHaveBeenCalledTimes(1));
    expect(input.value).toBe("smad5");
  });

  it("shows protein name and a resolved badge on resolved hits", async () => {
    searchMock = vi.fn(async (q: string) => (q === "Q5MD89" ? [reviewedHit] : []));
    resolveMock = vi.fn(async () => [{ input: "A0A2R8QSE0", resolved: "Q5MD89", af_id: "Q5MD89", note: "n" }]);
    const { root, input, button } = mount();
    input.value = "A0A2R8QSE0";
    button.click();
    await vi.waitFor(() => expect(root.querySelectorAll("[role=option]")).toHaveLength(1));
    expect(root.textContent).toContain("from A0A2R8QSE0");
  });
});
