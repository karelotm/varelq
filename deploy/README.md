# Self-hosted OCR on Brev (NVIDIA nemotron-ocr-v2 NIM)

State on 27 Sep 2026: Brev instance `varelq-ocr` (GCP g2-standard-8, NVIDIA L4 24 GB, about $1.08/h).
`start-ocr.sh` was run at about 12:43 machine time (UTC); the container `varelq-ocr`
(`nvcr.io/nim/nvidia/nemotron-ocr-v2:2.0`) is bound to **VM 127.0.0.1:8000** and `/v1/health/ready`
returned 200 on the VM. The Build API key was accepted for the registry login and image pull.
Not yet verified: an inference request against the NIM and the host tunnel (both left to the lead).

## Files

| File | Runs on | Purpose |
|---|---|---|
| `start-ocr.sh` | VM | Pulls and starts the OCR NIM on VM loopback; key via stdin |
| `capture-gpu.sh` | VM | One `nvidia-smi` capture as JSON for `deploy/gpu-capture.json` |
| `start-app.sh` | VM | Runs the whole app + access-code gate next to the NIM (see `HOSTING.md`) |
| `gate.py` | VM | Access code + rate limit reverse proxy (stdlib) |
| `HOSTING.md` | — | Prepared public-demo procedure; publishing needs user approval |

## Deploy the NIM (key on stdin only)

```bash
KEYFILE='C:\Users\PC\AppData\Local\Temp\claude\C--dev-Valerq\3df3c8a4-3640-449e-adfc-3b84c95ca57c\scratchpad\nvidia.key'
{ printf 'export NGC_API_KEY=%q\n' "$(tr -d '\r\n' < "$KEYFILE")"; cat deploy/start-ocr.sh; } \
  | docker exec -i varelq-brev-client ssh varelq-ocr 'bash -s'
```

## Tunnel to Windows (loopback only)

```bash
docker exec -d varelq-brev-client ssh -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -L 0.0.0.0:8000:127.0.0.1:8000 varelq-ocr
curl -sf http://127.0.0.1:8000/v1/health/ready
```

The forward binds 0.0.0.0 only inside the client container; Docker publishes it on host `127.0.0.1:8000` only.

## App configuration

```
NVIDIA_OCR_URL=http://127.0.0.1:8000/v1/ocr
NVIDIA_OCR_LABEL="NIM on Brev L4"
NVIDIA_OCR_FALLBACK=hosted
```

`ocr.py` calls the self-hosted endpoint first (20 s timeout, `NVIDIA_OCR_TIMEOUT`). On a connection error,
timeout or 5xx it retries once on the hosted endpoint and marks the page `fallback_used: true`,
`endpoint_kind: "hosted"`. 4xx errors are not retried. The Build key is never sent to the self-hosted
endpoint (only `NVIDIA_OCR_API_KEY`, if set).

## GPU capture for Settings

```bash
docker exec -i varelq-brev-client ssh varelq-ocr 'bash -s' < deploy/capture-gpu.sh > deploy/gpu-capture.json
```

`gpu.py` reports this file with its `captured_at`; there is no live probe of the GPU.

Official docs: https://docs.nvidia.com/nim/ingestion/image-ocr/latest/getting-started.html

Teardown: see `HOSTING.md` section 7 (the user does it).
