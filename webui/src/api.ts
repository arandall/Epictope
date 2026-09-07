const J = (r: Response) => r.json();
export const fetchSearch = (q: string) => fetch(`/api/search?q=${encodeURIComponent(q)}`).then(J);
export const fetchResolve = (accessions: string[]) => fetch("/api/resolve", { method:"POST",
  headers:{"Content-Type":"application/json"}, body: JSON.stringify({ accessions }) }).then(J);
export const fetchStatus = () => fetch("/api/status").then(J);

export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }

// GET a results endpoint; a non-ok response is an ApiError carrying the server's detail.
const getJson = async (url: string) => {
  const r = await fetch(url);
  if (!r.ok) {
    const detail = (await r.json().catch(() => ({})))?.detail ?? r.statusText;
    throw new ApiError(r.status, String(detail));
  }
  return r.json();
};

export const runPrediction = async (uniprot_id: string, n_terminal: number | null, file: File | null) => {
  const fd = new FormData(); fd.append("uniprot_id", uniprot_id);
  if (n_terminal != null) fd.append("n_terminal", String(n_terminal));
  if (file) fd.append("custom_structure", file);
  const r = await fetch("/api/run", { method: "POST", body: fd });
  if (!r.ok) {
    const detail = (await r.json().catch(() => ({})))?.detail ?? r.statusText;
    throw new ApiError(r.status, String(detail));
  }
  return r.json() as Promise<{ job_id: string }>;
};
export const fetchJob = (id: string) => getJson(`/api/jobs/${id}`);
export const fetchScore = (id: string) => getJson(`/api/results/${id}/score`);
export const fetchMsa = (id: string) => getJson(`/api/results/${id}/msa`);
export const fetchInfo = (id: string) => getJson(`/api/results/${id}/info`);
