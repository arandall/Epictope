// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
// Side-effect import: with `test.css` enabled, vitest injects the real
// stylesheet into the document, so these tests assert the actual cascade a
// browser would apply, not a restated copy of the CSS.
import "../src/style.css";

describe("page layout", () => {
  it("keeps the results section (and its cards) hidden until it has content", () => {
    // `#results { display: grid }` must not defeat the `hidden` attribute:
    // on a fresh page with no query the three empty cards stay invisible.
    document.body.innerHTML = `<main><section id="results" hidden><div class="card"></div></section></main>`;
    expect(getComputedStyle(document.getElementById("results")!).display).toBe("none");
  });

  it("still shows the results section as a grid once unhidden", () => {
    document.body.innerHTML = `<main><section id="results"><div class="card"></div></section></main>`;
    expect(getComputedStyle(document.getElementById("results")!).display).toBe("grid");
  });

  it("lets main and the results section span the full window width", () => {
    document.body.innerHTML = `<main><section id="results"></section></main>`;
    expect(getComputedStyle(document.querySelector("main")!).maxWidth).toBe("none");
    expect(getComputedStyle(document.getElementById("results")!).maxWidth).toBe("none");
  });

  it("highlights the marked MSA column with inverted cells, not a tinted ruler row", () => {
    // .cell.red proves var()-free declarations resolve in jsdom; .rulermark is
    // declared var()-free for exactly this reason (see style.css).
    document.body.innerHTML = `<span class="cell red">A</span>`;
    expect(getComputedStyle(document.querySelector(".cell.red")!).backgroundColor).toBe("rgb(230, 57, 70)");
    // only the number/arrow spans get the danger colour — the ruler row itself
    // keeps the muted inherited colour (its var() won't resolve in jsdom, and
    // that asymmetry is exactly what this assertion relies on)
    document.body.innerHTML = `<span class="msastrip msaruler">  <span class="rulermark">5</span> \n<span class="rulermark arr">▼</span></span>`;
    expect(getComputedStyle(document.querySelector(".rulermark")!).color).toBe("rgb(185, 28, 28)");
    expect(getComputedStyle(document.querySelector(".msaruler")!).color).toBe("var(--muted)");
    // the arrow sits in a fixed 1ch box so a fallback-font glyph can't shift
    // the ruler out of column alignment
    expect(getComputedStyle(document.querySelector(".rulermark.arr")!).width).toBe("1ch");
  });
});
