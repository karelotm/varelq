#!/usr/bin/env bash
# Run ON the GPU VM (piped over ssh). Prints one JSON nvidia-smi capture for deploy/gpu-capture.json.
#   docker exec -i varelq-brev-client ssh varelq-ocr 'bash -s' < deploy/capture-gpu.sh > deploy/gpu-capture.json
set -euo pipefail
IFS=',' read -r name used total driver < <(nvidia-smi --query-gpu=name,memory.used,memory.total,driver_version --format=csv,noheader,nounits | head -1)
container=$(docker ps --filter name=varelq-ocr --format '{{.Image}} {{.Status}}' | head -1)
trim() { local s="$1"; s="${s#"${s%%[![:space:]]*}"}"; printf '%s' "${s%"${s##*[![:space:]]}"}"; }
printf '{"name":"%s","memory_used_mib":%s,"memory_total_mib":%s,"driver":"%s","captured_at":"%s","instance":"varelq-ocr (Brev, GCP g2-standard-8)","container":"%s"}\n' \
  "$(trim "$name")" "$(trim "$used")" "$(trim "$total")" "$(trim "$driver")" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(trim "$container")"
