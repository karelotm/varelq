# Expanded evaluation

Two scripts, no server management:

1. `run_eval.py --base URL --out DIR [--only sroie,cord,synthetic] [--concurrency 1|2] [--timeout 240]`
   posts every document to `/api/documents/analyze` the same way `scripts/seed_demo.py` `seed_document` does and
   writes one raw JSON per document (`<dataset>__<id>.json`: HTTP status, wall time, full response). Receipts
   (SROIE, CORD) go in as the invoice role only. Synthetic three-way sets are fetched from `/api/samples` with
   all three roles and posted with their `sample_id`. Existing files are skipped unless you pass `--force`, so
   you can resume a run that stopped partway. The script never reads an API key.
2. `score.py --raw DIR --out scripts/eval/results.json [--code-version TEXT]` scores the raw responses against
   the ground truth in the repo. The module docstring lists the metric definitions and normalisation.

Typical run (start your own server with its own `PORT` and a fresh `VARELQ_DB`, key only in its environment,
`NIM_CONCURRENCY=2 LAB_LLM_CONCURRENCY=2`):

```
python scripts/eval/run_eval.py --base http://127.0.0.1:8391 --out $TMP/eval/raw --concurrency 2
python scripts/eval/score.py --raw $TMP/eval/raw --out scripts/eval/results.json --code-version "<hash>"
```

Data:
- `public-data/sroie`: 20 receipts with key files (company, date, address, total) and box text. MIT repository.
- `public-data/cord`: 10 CORD v2 test receipts (menu, subtotal, tax, total). CC-BY-4.0.
- `sample-documents/eval`: 10 synthetic three-way sets with planted discrepancies (`expected_findings` in
  `sample-documents/manifest.json`).

Each run uses about 2 NVIDIA calls per document (1 OCR, 1 LLM), and the shared limit is 40 requests a minute.

`scripts/eval/results.json` is the scored output of `score.py` and the source of the ACCURACY.md §5 figures (for example SROIE totals 18/20 and planted three-way problems 3/7).
