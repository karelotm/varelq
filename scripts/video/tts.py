"""Generate the voice-over: one mp3 per VOICEOVER.md segment, plus durations and a planned SRT.

Reads the six-row table in VOICEOVER.md and speaks the text verbatim with edge-tts.
One speaking rate is used for all segments so the pace stays even; if the total
(title card + audio + pads) would exceed 90 s, the rate is raised in small steps.
Each screen is then held for its own audio duration + PAD, so segments may drift a
little from the nominal slots in VOICEOVER.md while the whole video stays <= 90 s.

Writes to <out>/audio/:
  seg1.mp3 .. seg6.mp3
  timings.json   segment text, slot, measured duration, rate and sentence timings
  planned.srt    captions assuming each screen lasts its audio duration + pad

Usage: python tts.py --out <workdir> [--voice en-US-AndrewNeural]
"""
import argparse
import asyncio
import json
import re
import subprocess
from pathlib import Path

import edge_tts
import imageio_ffmpeg

ROOT = Path(__file__).resolve().parents[2]
# Spoken form of the product name; captions keep "VARELQ".
SAY = {'VARELQ': 'Varel Q'}
PAD = 0.6            # seconds of silence kept after each segment's audio
TITLE_CARD = 1.5     # seconds of title card before segment 1 (dropped if total would exceed 90s)
MAX_TOTAL = 90.0


def parse_voiceover(path: Path):
    """Return [{n, start, end, screen, text}] from the markdown table."""
    segs = []
    for line in path.read_text(encoding='utf-8').splitlines():
        m = re.match(r'\|\s*(\d+)\s*\|\s*(\d+):(\d+)\D+(\d+):(\d+)\s*\|\s*([^|]+)\|\s*([^|]+)\|', line)
        if not m:
            continue
        n, m1, s1, m2, s2, screen, text = m.groups()
        segs.append({'n': int(n), 'start': int(m1) * 60 + int(s1), 'end': int(m2) * 60 + int(s2),
                     'screen': screen.strip(), 'text': text.strip()})
    if len(segs) != 6:
        raise SystemExit(f'expected 6 segments in {path}, found {len(segs)}')
    return segs


def media_duration(path: Path) -> float:
    """Duration in seconds, read from ffmpeg's banner (no ffprobe needed)."""
    r = subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), '-hide_banner', '-i', str(path)],
                       capture_output=True, text=True)
    m = re.search(r'Duration: (\d+):(\d+):(\d+\.\d+)', r.stderr)
    if not m:
        raise RuntimeError(f'cannot read duration of {path}')
    h, mi, s = m.groups()
    return int(h) * 3600 + int(mi) * 60 + float(s)


async def speak(text: str, voice: str, rate: int, mp3: Path):
    """Synthesize text to mp3 and return sentence boundaries [(start_s, end_s, text)]."""
    spoken = text
    for written, said in SAY.items():
        spoken = spoken.replace(written, said)
    comm = edge_tts.Communicate(spoken, voice, rate=f'{rate:+d}%', boundary='SentenceBoundary')
    sentences = []
    with mp3.open('wb') as f:
        async for chunk in comm.stream():
            if chunk['type'] == 'audio':
                f.write(chunk['data'])
            elif chunk['type'] in ('SentenceBoundary', 'WordBoundary'):
                start = chunk['offset'] / 1e7
                caption = chunk['text']
                for written, said in SAY.items():
                    caption = caption.replace(said, written)
                sentences.append([start, start + chunk['duration'] / 1e7, caption])
    return sentences


def srt_time(t: float) -> str:
    ms = int(round(t * 1000))
    return f'{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}'


def caption_chunks(sentences, max_chars=90):
    """Split long sentences at commas/colons so each caption stays on about two lines."""
    out = []
    for start, end, text in sentences:
        if len(text) <= max_chars:
            out.append((start, end, text))
            continue
        parts = [p for p in re.split(r'(?<=[,:])\s+', text) if p]
        total = sum(len(p) for p in parts)
        t = start
        for p in parts:
            d = (end - start) * len(p) / total
            out.append((t, t + d, p))
            t += d
    return out


def build_srt(segments, starts):
    """segments: timings.json entries; starts: absolute start time (s) of each segment in the final video."""
    lines, i = [], 1
    for seg, s0 in zip(segments, starts):
        chunks = caption_chunks(seg['sentences'])
        for k, (a, b, text) in enumerate(chunks):
            # keep each caption up until the next one starts (or the end of the audio)
            nxt = chunks[k + 1][0] if k + 1 < len(chunks) else seg['duration']
            lines += [str(i), f'{srt_time(s0 + a)} --> {srt_time(s0 + max(b, nxt - 0.05))}', text, '']
            i += 1
    return '\n'.join(lines)


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--voice', default='en-US-AndrewNeural')
    ap.add_argument('--rate', type=int, default=5, help='speaking rate in percent')
    args = ap.parse_args()
    out = Path(args.out) / 'audio'
    out.mkdir(parents=True, exist_ok=True)

    segs = parse_voiceover(ROOT / 'VOICEOVER.md')
    rate = args.rate
    while True:
        for seg in segs:
            mp3 = out / f"seg{seg['n']}.mp3"
            sentences = await speak(seg['text'], args.voice, rate, mp3)
            seg.update(slot=seg['end'] - seg['start'], duration=round(media_duration(mp3), 3),
                       rate=rate, sentences=sentences, mp3=mp3.name)
        if sum(s['duration'] + PAD for s in segs) + TITLE_CARD <= MAX_TOTAL or rate >= 20:
            break
        rate += 4
    for seg in segs:
        print(f"seg{seg['n']}: slot {seg['slot']:>2}s  audio {seg['duration']:5.2f}s  rate {rate:+d}%  ({seg['screen']})")

    body = sum(s['duration'] + PAD for s in segs)
    title = TITLE_CARD if body + TITLE_CARD <= MAX_TOTAL else 0.0
    starts, t = [], title
    for s in segs:
        starts.append(t)
        s['hold'] = round(s['duration'] + PAD, 3)
        t += s['hold']
    timings = {'voice': args.voice, 'pad': PAD, 'title_card': title, 'total': round(t, 3), 'segments': segs}
    (out / 'timings.json').write_text(json.dumps(timings, indent=2), encoding='utf-8')
    (out / 'planned.srt').write_text(build_srt(segs, starts), encoding='utf-8')
    print(f'total {t:.2f}s (title card {title}s) -> {out}')


if __name__ == '__main__':
    asyncio.run(main())
