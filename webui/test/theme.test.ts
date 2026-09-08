// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { initTheme, toggleTheme, mountThemeToggle, THEME_KEY, type Theme } from "../src/theme";

// jsdom has no matchMedia: install a controllable fake whose `matches` we can
// flip at will and whose change listeners we can fire to simulate OS switches.
let systemDark = false;
let mediaListeners: ((e: { matches: boolean }) => void)[] = [];

function installMatchMedia() {
  (window as any).matchMedia = (q: string) => ({
    matches: q.includes("dark") ? systemDark : !systemDark,
    media: q,
    addEventListener: (_: string, cb: (e: { matches: boolean }) => void) => { mediaListeners.push(cb); },
    removeEventListener: (_: string, cb: (e: { matches: boolean }) => void) => {
      mediaListeners = mediaListeners.filter(l => l !== cb);
    },
  });
}

// Flip the fake OS scheme and notify subscribers, like a real media change.
function setSystem(dark: boolean) {
  systemDark = dark;
  mediaListeners.forEach(l => l({ matches: dark }));
}

const applied = () => document.documentElement.dataset.theme as Theme | undefined;

describe("initTheme", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("data-theme");
    localStorage.clear();
    mediaListeners = [];
    systemDark = false;
    installMatchMedia();
  });

  it("follows the OS colour scheme when the user has not chosen", () => {
    systemDark = true;
    expect(initTheme()).toBe("dark");
    expect(applied()).toBe("dark");
  });

  it("keeps tracking OS scheme changes until the user picks a theme", () => {
    initTheme();
    expect(applied()).toBe("light");
    setSystem(true);
    expect(applied()).toBe("dark");
  });

  it("a stored choice wins over the OS scheme and pins the theme", () => {
    localStorage.setItem(THEME_KEY, "light");
    systemDark = true;
    initTheme();
    expect(applied()).toBe("light");
    setSystem(false);
    expect(applied()).toBe("light");
  });
});

describe("toggleTheme", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("data-theme");
    localStorage.clear();
    mediaListeners = [];
    systemDark = false;
    installMatchMedia();
    initTheme();
  });

  it("flips the theme, persists it, and announces the change", () => {
    const changed = vi.fn();
    window.addEventListener("themechange", changed);
    expect(toggleTheme()).toBe("dark");
    expect(applied()).toBe("dark");
    expect(localStorage.getItem(THEME_KEY)).toBe("dark");
    expect(changed).toHaveBeenCalledTimes(1);
    expect(toggleTheme()).toBe("light");
    expect(localStorage.getItem(THEME_KEY)).toBe("light");
    window.removeEventListener("themechange", changed);
  });

  it("a persisted toggle pins the theme against later OS changes", () => {
    toggleTheme(); // the user chose dark
    setSystem(false);
    expect(applied()).toBe("dark");
  });
});

describe("mountThemeToggle", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("data-theme");
    localStorage.clear();
    mediaListeners = [];
    systemDark = false;
    installMatchMedia();
    initTheme();
  });

  it("adds a header button that toggles the theme on click", () => {
    const header = document.createElement("header");
    document.body.appendChild(header);
    mountThemeToggle(header);
    const btn = header.querySelector<HTMLButtonElement>(".themebtn")!;
    expect(btn).toBeTruthy();
    expect(applied()).toBe("light");
    btn.click();
    expect(applied()).toBe("dark");
    expect(localStorage.getItem(THEME_KEY)).toBe("dark");
    btn.click();
    expect(applied()).toBe("light");
  });

  it("labels the button for the mode it switches to", () => {
    const header = document.createElement("header");
    document.body.appendChild(header);
    mountThemeToggle(header);
    const btn = header.querySelector<HTMLButtonElement>(".themebtn")!;
    expect(btn.getAttribute("aria-label")).toBe("Switch to dark mode");
    btn.click();
    expect(btn.getAttribute("aria-label")).toBe("Switch to light mode");
  });
});
