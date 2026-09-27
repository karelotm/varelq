#!/usr/bin/env bash
set -euo pipefail
# Run on the GPU VM. Never put credentials in this file.
if [[ -z "${NGC_API_KEY:-}" ]]; then
  read -rsp 'NGC Catalog API key: ' NGC_API_KEY
  printf '\n'
fi
export NGC_API_KEY
nvidia-smi
# Use an ephemeral Docker configuration so registry credentials are not retained.
export DOCKER_CONFIG
DOCKER_CONFIG=$(mktemp -d)
trap 'rm -rf -- "$DOCKER_CONFIG"; unset NGC_API_KEY' EXIT
printf '%s' "$NGC_API_KEY" | docker login nvcr.io --username '$oauthtoken' --password-stdin
docker pull nvcr.io/nim/nvidia/nemotron-ocr-v2:2.0
mkdir -p "$HOME/.cache/varelq-ocr/cache" "$HOME/.cache/varelq-ocr/weights"
docker run -d --name varelq-ocr --gpus '"device=0"' --shm-size=16g \
  -e NGC_API_KEY -e NIM_ENGINE_MODEL_DOWNLOAD_PROVIDER=ngc \
  -v "$HOME/.cache/varelq-ocr/cache:/opt/cache" \
  -v "$HOME/.cache/varelq-ocr/weights:/model" \
  -u "$(id -u)" -p 127.0.0.1:8000:8000 \
  nvcr.io/nim/nvidia/nemotron-ocr-v2:2.0
printf 'Check readiness: curl --fail http://127.0.0.1:8000/v1/health/ready\n'
printf 'Stopping this container does not stop VM billing. Stop/delete the Brev environment after testing.\n'
