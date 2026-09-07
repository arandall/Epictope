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
