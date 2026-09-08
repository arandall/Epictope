// Last 10 searches, persisted in localStorage so the search page can offer
// one-click re-runs. Best-effort: private-mode storage failures are ignored.
export interface RecentEntry { q: string; at: number }
const KEY = "epictope.recentSearches";

export function loadRecent(): RecentEntry[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    if (!Array.isArray(v)) return [];
    return v.filter(e => e && typeof e.q === "string").slice(0, 10);
  } catch {
    return [];
  }
}

export function pushRecent(e: { q: string }): RecentEntry[] {
  const list = loadRecent().filter(x => x.q !== e.q);
  list.unshift({ q: e.q, at: Date.now() });
  const trimmed = list.slice(0, 10);
  try { localStorage.setItem(KEY, JSON.stringify(trimmed)); } catch { /* ignore */ }
  return trimmed;
}
