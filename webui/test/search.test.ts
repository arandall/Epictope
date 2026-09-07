// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mountSearch } from "../src/search";

const hits = [
  { accession: "Q9W7E7", gene: "smad5", organism: "Danio rerio", reviewed: true, hasAlphaFold: true },
  { accession: "A0A0R4IFS9", gene: "smad5", organism: "Danio rerio", reviewed: false, hasAlphaFold: false },
];

vi.mock("../src/api", () => ({
  fetchSearch: vi.fn(async (q: string) => (q === "smad5" ? hits : [])),
}));

import { fetchSearch } from "../src/api";

function mount(onSelect = vi.fn()) {
  const root = document.createElement("div");
  document.body.appendChild(root);
  mountSearch(root, onSelect);
  return { root, onSelect, input: root.querySelector("input")! };
}

async function type(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event("input"));
  await vi.advanceTimersByTimeAsync(350);
}

describe("mountSearch", () => {
  beforeEach(() => { vi.useFakeTimers(); document.body.innerHTML = ""; });
  it("debounces input and renders a listbox of hits", async () => {
    const { root, input } = mount();
    await type(input, "smad5");
    expect(fetchSearch).toHaveBeenCalledTimes(1);
    const items = root.querySelectorAll("[role=option]");
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain("Q9W7E7");
    expect(items[0].textContent).toContain("reviewed");
  });
  it("Enter selects the active option and calls onSelect", async () => {
    const { root, input, onSelect } = mount();
    await type(input, "smad5");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(onSelect).toHaveBeenCalledWith(hits[0]);
    expect(root.querySelector("[role=listbox]")).toBeNull();
  });
  it("shows an empty message when there are no hits", async () => {
    const { root, input } = mount();
    await type(input, "zzzz");
    expect(root.textContent).toContain("No UniProt entries match");
  });
  it("Escape closes the dropdown", async () => {
    const { root, input } = mount();
    await type(input, "smad5");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(root.querySelector("[role=listbox]")).toBeNull();
  });
});
