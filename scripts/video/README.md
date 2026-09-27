# Demo video pipeline

Builds the 90-second VARELQ demo (`video-out/varelq-demo.mp4`) from recorded data only:
generated English voice-over, scripted browser walkthrough, burned-in captions.
All tools are open source and are installed in a separate virtualenv, not in the app's `requirements.txt`.

| Step | Script | Output |
|---|---|---|
| 1. Voice-over | `tts.py` | `audio/seg1..6.mp3`, `audio/timings.json`, `audio/planned.srt` |
| 2. Walkthrough | `record.py` | `raw/*.webm`, `marks.json`, `shots/seg1..6.png` |
| 3. Final cut | `make_video.py` | `video-out/varelq-demo.mp4` (H.264 1920x1080 30 fps, AAC) |

- The text comes verbatim from `VOICEOVER.md` (six segments, one screen each), spoken by
  edge-tts (`en-US-AndrewNeural`, one rate for all segments, raised only if the total would pass 90 s).
- Each screen is held for its segment's audio length + 0.6 s. A 1.5 s title card is added only if the total stays within 90 s.
- `record.py` logs when each screen actually appears (`marks.json`); `make_video.py` places each audio
  segment and caption at those marks, so voice and picture stay in sync.
- The recording aborts every non-GET request, so it never starts a run or records a decision.
  It hides the provenance chips in the top bar (the viewer runs without an NVIDIA key; the data was recorded with one).

## Run

```sh
W=<workdir>                      # any scratch folder
python -m venv $W/venv
$W/venv/Scripts/python -m pip install playwright imageio-ffmpeg edge-tts
$W/venv/Scripts/python -m playwright install chromium   # skip if already cached

# serve the recorded demo data (a copy of the demo DB; no NVIDIA key needed)
PORT=8396 VARELQ_DB=$W/demo.sqlite3 python server.py &

$W/venv/Scripts/python scripts/video/tts.py        --out $W
$W/venv/Scripts/python scripts/video/record.py     --out $W --url http://127.0.0.1:8396/
$W/venv/Scripts/python scripts/video/make_video.py --out $W   # -> video-out/varelq-demo.mp4
```

Check `$W/shots/seg*.png` to confirm each screen shows the right content.
The demo DB must contain the AgentRx reliability run, the S4 baseline/guarded lab batches and the INV-0142 three-way case.
Captions use Segoe UI (copied from `C:/Windows/Fonts`); on other systems change `FontName` in `make_video.py`.
