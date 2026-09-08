# tests/smoke/smoke.sh
#!/usr/bin/env bash
set -e
ID=Q9W7E7
docker build -t epictope:smoke .
docker run --rm -d --name epictope_smoke -p 8000:8000 -v "$PWD/data:/app/data" -v "$PWD/outputs:/app/outputs" epictope:smoke
for i in $(seq 1 120); do
  INSTALLED=$(curl -s localhost:8000/api/status | grep -o '"installed":[a-z]*' | cut -d: -f2)
  [ "$INSTALLED" = "true" ] && break
  sleep 10
done
echo "Triggering run for $ID"
JOB=$(curl -s -X POST localhost:8000/api/run -F "uniprot_id=$ID")
JID=$(echo "$JOB" | grep -o '"job_id":"[^"]*"' | cut -d'"' -f4)
for i in $(seq 1 60); do
  ST=$(curl -s localhost:8000/api/jobs/$JID | grep -o '"status":"[^"]*"' | cut -d'"' -f4)
  [ "$ST" = "done" ] && break
  [ "$ST" = "error" ] && { echo "JOB ERROR"; docker logs epictope_smoke; exit 1; }
  sleep 10
done
curl -s localhost:8000/api/results/$ID/score | head -c 80; echo
test -f outputs/$ID/$ID"_score.csv" && echo "SCORE OK"
test -f outputs/$ID/$ID"_msa.fasta" && echo "MSA OK"
docker stop epictope_smoke
