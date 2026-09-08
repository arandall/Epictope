export type AppState =
  | { kind: "empty" }
  | { kind: "selected"; acc: string }
  | { kind: "running"; acc: string; jobId: string }
  | { kind: "results"; acc: string }
  | { kind: "error"; acc: string; message: string };

export function parseUrl(): string | null {
  return new URLSearchParams(window.location.search).get("id");
}

export function setUrl(acc: string | null): void {
  const url = acc == null ? window.location.pathname : `?id=${encodeURIComponent(acc)}`;
  window.history.replaceState(null, "", url);
}

export function onUrlChange(cb: (acc: string | null) => void): void {
  window.addEventListener("popstate", () => cb(parseUrl()));
}

export const DEFAULT_MSA_WRAP = 200;

// MSA columns per line; override with ?msa-chunk=N (clamped to a sane range).
export function parseChunk(): number {
  const raw = new URLSearchParams(window.location.search).get("msa-chunk");
  const v = Number(raw);
  if (raw == null || !Number.isFinite(v) || v <= 0) return DEFAULT_MSA_WRAP;
  return Math.min(2000, Math.max(40, Math.floor(v)));
}
