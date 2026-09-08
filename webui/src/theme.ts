// Dark/light theme: `data-theme="light|dark"` on <html> drives the CSS token
// blocks. Resolution order: stored choice (localStorage) > OS colour scheme
// > light. An inline <head> script in index.html applies the same resolution
// before first paint, so this module only has to keep the attribute in sync
// and announce changes (chart.ts re-reads its colours on "themechange").
export type Theme = "light" | "dark";
export const THEME_KEY = "epictope.theme";

const store = {
  get(): Theme | null {
    try { return localStorage.getItem(THEME_KEY) === "dark" ? "dark"
             : localStorage.getItem(THEME_KEY) === "light" ? "light" : null; }
    catch { return null; }
  },
  set(t: Theme) {
    try { localStorage.setItem(THEME_KEY, t); } catch { /* private mode */ }
  },
};

function systemTheme(): Theme {
  try {
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch { return "light"; }
}

function apply(t: Theme): void {
  document.documentElement.dataset.theme = t;
}

// Follow the OS colour scheme until the user explicitly picks a theme.
function trackSystem(): void {
  try {
    window.matchMedia?.("(prefers-color-scheme: dark)")
      .addEventListener("change", (e) => { if (!store.get()) apply(e.matches ? "dark" : "light"); });
  } catch { /* very old browsers: no live tracking */ }
}

export function initTheme(): Theme {
  const t = store.get() ?? systemTheme();
  apply(t);
  if (!store.get()) trackSystem(); // a stored choice pins the theme
  return t;
}

export function toggleTheme(): Theme {
  const t: Theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  apply(t);
  store.set(t); // pinning here also stops future OS changes overriding
  window.dispatchEvent(new CustomEvent("themechange"));
  return t;
}

// Sun/moon glyphs; aria-label always names the mode the click switches TO.
function glyph(to: Theme): string {
  return to === "dark"
    ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>`
    : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/></svg>`;
}

function label(to: Theme): string {
  return to === "dark" ? "Switch to dark mode" : "Switch to light mode";
}

export function mountThemeToggle(header: HTMLElement): void {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "themebtn";
  const to = (): Theme => document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  const sync = () => { btn.innerHTML = glyph(to()); btn.setAttribute("aria-label", label(to())); btn.title = label(to()); };
  sync();
  btn.addEventListener("click", () => { toggleTheme(); sync(); });
  header.appendChild(btn);
}
