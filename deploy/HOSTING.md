# Hosting the VARELQ demo on the Brev L4 VM (prepared, not executed)

Status: **prepared only.** Nothing described here has made anything public. The public step (section 5) is
for the lead to run **only after the user approves**. Agents must not run it.

## Target layout

```
visitor ──HTTPS──> public tunnel (step 5, lead + user approval only)
                     │
VM 127.0.0.1:8080  varelq-gate   deploy/gate.py: access code, per-client rate limit, daily POST cap
                     │  rewrites Host/Origin to 127.0.0.1:8390
VM 127.0.0.1:8390  varelq-app    python server.py (binds 127.0.0.1), SQLite in ~/varelq-data
                     │  LLM: hosted Nemotron (integrate.api.nvidia.com), key stays server-side
VM 127.0.0.1:8000  varelq-ocr    nemotron-ocr-v2 NIM on the L4 (deploy/start-ocr.sh)
                        fallback: hosted OCR, labelled "fallback" per page
```

All three containers listen on VM loopback only. No `0.0.0.0` bind, no firewall change.

## 1. Preconditions

- The OCR NIM is running (`deploy/start-ocr.sh`, already done at 12:43 machine time).
  Check: `docker exec varelq-brev-client ssh varelq-ocr 'curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8000/v1/health/ready'` returns `200`.
- The code to ship is committed by the lead (so the VM runs the frozen version).

## 2. Copy the app to the VM (no git remote needed)

From the repo root on Windows (Git Bash). Only tracked files are sent, so `data/`, keys and DBs stay behind:

```bash
git archive --format=tar HEAD | docker exec -i varelq-brev-client ssh varelq-ocr 'rm -rf ~/varelq && mkdir -p ~/varelq && tar -x -C ~/varelq'
```

## 3. Start the app and the gate on the VM

The key and the access code travel on stdin only, never in argv or logs. Pick a new access code
(at least 8 characters) and share it with judges out of band (for example in the submission form).

```bash
KEYFILE='C:\Users\PC\AppData\Local\Temp\claude\C--dev-Valerq\3df3c8a4-3640-449e-adfc-3b84c95ca57c\scratchpad\nvidia.key'
read -rsp 'Demo access code: ' CODE; echo
{ printf 'export NVIDIA_API_KEY=%q\n' "$(tr -d '\r\n' < "$KEYFILE")";
  printf 'export VARELQ_ACCESS_CODE=%q\n' "$CODE";
  printf 'export GATE_CLIENT_IP_HEADER=%q\n' 'CF-Connecting-IP';   # only if step 5 uses Cloudflare
  cat deploy/start-app.sh; } | docker exec -i varelq-brev-client ssh varelq-ocr 'bash -s'
unset CODE
```

Expected output: the `/api/health` JSON with `"ocr":{"mode":"self-hosted","label":"NIM on Brev L4",...}`
and `gate /api/health without code: HTTP 401`.

### Gate and rate-limit settings (env vars read by `deploy/gate.py`)

| Variable | Default | Meaning |
|---|---|---|
| `VARELQ_ACCESS_CODE` | required | Shared code; at least 8 characters; compared in constant time; never logged |
| `GATE_POST_PER_MIN` | 6 | POST requests per visitor per minute (analyses, lab runs: these spend NVIDIA credits) |
| `GATE_GET_PER_MIN` | 240 | GET requests per visitor per minute |
| `GATE_DAILY_POST_CAP` | 300 | Global POST cap per UTC day (hard budget stop) |
| `GATE_CLIENT_IP_HEADER` | empty | Visitor-IP header set by the tunnel (`CF-Connecting-IP` for Cloudflare). Empty = per-socket IP, so all visitors share one bucket |
| `GATE_PORT` / `GATE_UPSTREAM` | 8080 / `http://127.0.0.1:8390` | Loopback addresses |

App-side NVIDIA settings passed by `start-app.sh` (export them on stdin like the key to override):
`NVIDIA_RPM_LIMIT` (default 40, the Build key's requests/minute; the app waits up to 20 s rather than hit 429)
and `NIM_FALLBACK_MODEL` (default `nvidia/nemotron-3.5-lightning-30b-a3b`, separate quota; used once after the
primary model exhausts retries on 429/5xx/timeout and recorded as `fallback_used`; export an empty value to disable).
`GET /api/usage` (through the gate) shows per-model counters, the rolling 60 s count and live L4 metrics from the
NIM's `/v1/metrics`.

Login attempts are limited to 5 per minute per visitor. The cookie is HttpOnly, SameSite=Strict,
12 hours, and marked Secure when the tunnel sends `X-Forwarded-Proto: https`.

**No change to `server.py` is needed.** The gate forwards with `Host: 127.0.0.1:8390` and rewrites a
same-site `Origin` to `http://127.0.0.1:8390`, so the app's Host allow-list and Origin check stay strict.
It rejects a cross-site `Origin` itself (403). `VARELQ_ALLOWED_HOSTS` stays unset.

## 4. Verify on the VM (still private)

```bash
docker exec varelq-brev-client ssh varelq-ocr 'curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8080/'        # 303 to /__gate
docker exec varelq-brev-client ssh varelq-ocr 'docker logs --tail 20 varelq-app; docker logs --tail 20 varelq-gate'
```

Optional private check from Windows (loopback only, like the OCR tunnel): forward the gate to host port 8391.
The client container already publishes only `127.0.0.1:8000`; add a new forward the same way the lead does for 8000.

## 5. Publish (lead only, after explicit user approval)

Two options. Both expose **only the gate** (8080), never 8390 or 8000.

**A. Brev console:** instance `varelq-ocr` → Access → share/expose a service on port 8080 (the console
issues a public URL). Check the console wording at the time; do not expose 8000 or 8390.

**B. Cloudflare quick tunnel on the VM** (random `*.trycloudflare.com` URL, no account):

```bash
docker exec varelq-brev-client ssh varelq-ocr \
  'docker run -d --name varelq-tunnel --network host cloudflare/cloudflared:latest tunnel --no-autoupdate --url http://127.0.0.1:8080'
docker exec varelq-brev-client ssh varelq-ocr 'sleep 8; docker logs varelq-tunnel 2>&1 | grep -o "https://[a-z0-9-]*\.trycloudflare\.com" | head -1'
```

With option B, run step 3 with `GATE_CLIENT_IP_HEADER=CF-Connecting-IP` so the per-visitor limit works.

Smoke test the public URL: `/` redirects to `/__gate`; a wrong code gets 401; the right code opens the app;
`/api/health` without the cookie gets 401.

## 6. Honesty notes for the demo link

- OCR pages show `endpoint_kind` (`self-hosted` / `hosted`) and measured `latency_ms`; hosted fallback is labelled.
- GPU facts in Settings come from `deploy/gpu-capture.json` with its `captured_at`, never "live".
- Sample sets `three-way-*` are synthetic and say so on the documents themselves.
- No speed comparison is claimed.

## 7. Teardown (the user does this)

```bash
docker exec varelq-brev-client ssh varelq-ocr 'docker rm -f varelq-tunnel varelq-gate varelq-app varelq-ocr'
docker exec varelq-brev-client brev stop varelq-ocr     # or delete the instance in the Brev console
```

Then revoke the temporary NVIDIA key at build.nvidia.com and change nothing else.
The VM keeps billing (about $1.08/h) until it is stopped or deleted.
