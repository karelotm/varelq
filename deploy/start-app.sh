#!/usr/bin/env bash
# Run ON the Brev GPU VM, next to the OCR NIM started by start-ocr.sh. Never put credentials in this file.
#
# Starts two containers on the VM, both on VM loopback only (nothing public):
#   varelq-app   python server.py on 127.0.0.1:8390  (hosted Nemotron LLM + local OCR NIM at 127.0.0.1:8000)
#   varelq-gate  deploy/gate.py on 127.0.0.1:8080    (access code + rate limit, proxies to the app)
# Publishing 127.0.0.1:8080 to the internet is a separate, lead-only step after user approval (HOSTING.md).
#
# Secrets arrive on stdin as shell exports (see HOSTING.md), or are prompted for when run interactively:
#   NVIDIA_API_KEY       Build key for hosted Nemotron (LLM) and hosted OCR fallback
#   VARELQ_ACCESS_CODE   shared demo access code, >= 8 characters
set -euo pipefail
APP_DIR="${APP_DIR:-$HOME/varelq}"
DATA_DIR="${DATA_DIR:-$HOME/varelq-data}"
IMAGE="${IMAGE:-python:3.12-slim}"
if [[ -z "${NVIDIA_API_KEY:-}" ]]; then read -rsp 'NVIDIA API key: ' NVIDIA_API_KEY; printf '\n'; fi
if [[ -z "${VARELQ_ACCESS_CODE:-}" ]]; then read -rsp 'Demo access code (>= 8 chars): ' VARELQ_ACCESS_CODE; printf '\n'; fi
if (( ${#VARELQ_ACCESS_CODE} < 8 )); then echo 'Access code must be at least 8 characters.' >&2; exit 1; fi
export NVIDIA_API_KEY VARELQ_ACCESS_CODE
trap 'unset NVIDIA_API_KEY VARELQ_ACCESS_CODE' EXIT
test -f "$APP_DIR/server.py" || { echo "Copy the app to $APP_DIR first (HOSTING.md step 2)." >&2; exit 1; }
mkdir -p "$DATA_DIR" && chmod 700 "$DATA_DIR"

curl -sf -o /dev/null http://127.0.0.1:8000/v1/health/ready && echo 'OCR NIM ready on 127.0.0.1:8000' \
  || echo 'WARNING: OCR NIM not ready; the app will fall back to hosted OCR and label it "fallback".'

docker rm -f varelq-app varelq-gate >/dev/null 2>&1 || true
# --network host: the app reaches the NIM on VM loopback; server.py binds 127.0.0.1 only.
docker run -d --name varelq-app --restart unless-stopped --network host \
  -e NVIDIA_API_KEY -e PORT=8390 -e VARELQ_DB=/data/varelq.sqlite3 \
  -e NVIDIA_OCR_URL=http://127.0.0.1:8000/v1/infer -e 'NVIDIA_OCR_LABEL=NIM on Brev L4' -e NVIDIA_OCR_FALLBACK=hosted \
  -e PYTHONUNBUFFERED=1 \
  -v "$APP_DIR:/app:ro" -v "$DATA_DIR:/data" -w /app "$IMAGE" \
  sh -c 'pip install --no-cache-dir -q -r requirements.txt && exec python server.py'
docker run -d --name varelq-gate --restart unless-stopped --network host \
  -e VARELQ_ACCESS_CODE -e GATE_PORT=8080 -e GATE_UPSTREAM=http://127.0.0.1:8390 \
  -e GATE_POST_PER_MIN="${GATE_POST_PER_MIN:-6}" -e GATE_GET_PER_MIN="${GATE_GET_PER_MIN:-240}" \
  -e GATE_DAILY_POST_CAP="${GATE_DAILY_POST_CAP:-300}" -e GATE_CLIENT_IP_HEADER="${GATE_CLIENT_IP_HEADER:-}" \
  -e PYTHONUNBUFFERED=1 -v "$APP_DIR/deploy:/gate:ro" "$IMAGE" python /gate/gate.py

for i in $(seq 1 60); do
  if curl -sf -o /dev/null -H 'Host: 127.0.0.1:8390' http://127.0.0.1:8390/api/health; then break; fi; sleep 2
done
curl -s -H 'Host: 127.0.0.1:8390' http://127.0.0.1:8390/api/health | head -c 400; printf '\n'
curl -s -o /dev/null -w 'gate /api/health without code: HTTP %{http_code} (expect 401)\n' http://127.0.0.1:8080/api/health
printf 'App on VM 127.0.0.1:8390, gate on VM 127.0.0.1:8080. Nothing is public yet.\n'
printf 'Teardown: docker rm -f varelq-gate varelq-app\n'
