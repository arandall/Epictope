function navigate(url: string): void {
  const a = document.createElement("a");
  a.href = url;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function downloadScoreCsv(acc: string): void {
  navigate(`/api/results/${encodeURIComponent(acc)}/score.csv`);
}

export function downloadMsaFasta(acc: string): void {
  navigate(`/api/results/${encodeURIComponent(acc)}/msa.fasta`);
}

export function downloadChartPng(chart: { toBase64Image(): string }, acc: string): void {
  const a = document.createElement("a");
  a.href = chart.toBase64Image();
  a.download = `${acc}_min_score.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function printResults(): void {
  window.print();
}
