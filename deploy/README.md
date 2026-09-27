# Dedicated GPU OCR

The application already uses NVIDIA hosted GPU OCR by default. A dedicated VM is optional and has not been deployed.

Prepared Brev configuration: GCP L4 24GB, 8 CPU, 32GiB RAM, 256GiB disk. Console quote on 2026-09-27: $1.02/hour compute + $0.05/hour storage. Confirm current price before deployment. Stopped instances still incur storage charges. Deployment also requires acceptance of the console's GCP data-sharing terms.

On a provisioned Linux VM with NVIDIA Container Toolkit and Docker, run `bash start-ocr.sh`. The hidden prompt needs an NGC personal API key with Catalog access; Build API access alone does not verify container registry entitlement. The container must be licensed for your intended use. The script pins NVIDIA OCR v2 image version 2.0 and exposes it only on VM localhost. Docker administrators can inspect container environment credentials; remove the container after testing.

Use the SSH host/alias supplied by Brev to forward local port 8000:

```powershell
ssh -N -L 8000:127.0.0.1:8000 <Brev-SSH-host>
```

In a separate PowerShell terminal, from the application folder:

```powershell
$env:NVIDIA_OCR_URL = 'http://127.0.0.1:8000/v1/ocr'
$env:PORT = '8081'
python run.py
```

Keep the tunnel open. Text extraction still uses the hosted NVIDIA language model. Custom OCR endpoints receive only NVIDIA_OCR_API_KEY if explicitly configured; the Build key is not forwarded to them. To return to hosted OCR, remove NVIDIA_OCR_URL and restart the app. No automatic fallback hides a failed dedicated endpoint.

Check readiness at `/v1/health/ready`, upload the public receipt, inspect OCR source text and geometry, then remove the OCR container and stop/delete the environment in Brev. Deleting the environment removes disk data and stops storage charges; export needed results first.

Official setup: https://docs.nvidia.com/nim/ingestion/image-ocr/latest/getting-started.html

Supported GPU list: https://docs.nvidia.com/nim/ingestion/image-ocr/latest/support-matrix.html
