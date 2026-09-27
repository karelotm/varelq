"""Mux the recording with the voice-over and burn in captions -> H.264/AAC mp4.

Inputs (in <workdir>, written by tts.py and record.py):
  audio/timings.json, audio/segN.mp3, marks.json, raw/*.webm

Each segment's audio is placed at the moment its screen actually appeared in the
recording (marks.json), so picture and voice stay in sync even if a page load was slow.
The captions are rebuilt from the same marks (sentence timings from edge-tts).

Usage: python make_video.py --out <workdir> [--dest C:/dev/Valerq/video-out/varelq-demo.mp4]
"""
import argparse
import json
import re
import shutil
import subprocess
from pathlib import Path

import imageio_ffmpeg

from tts import build_srt, media_duration

ROOT = Path(__file__).resolve().parents[2]
MAX_TOTAL = 90.0
# Subtle captions: white sans on a translucent dark box, near the bottom.
# (SRT is rendered at PlayResY 288, so FontSize 9 is about 34 px at 1080p.)
CAPTION_STYLE = ('FontName=Segoe UI,FontSize=9,PrimaryColour=&H00FFFFFF,BorderStyle=3,'
                 'OutlineColour=&H80000000,BackColour=&H80000000,Outline=0.8,Shadow=0,MarginV=14,MarginL=40,MarginR=40')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--dest', default=str(ROOT / 'video-out' / 'varelq-demo.mp4'))
    args = ap.parse_args()
    work = Path(args.out).resolve()
    timings = json.loads((work / 'audio' / 'timings.json').read_text(encoding='utf-8'))
    marks = json.loads((work / 'marks.json').read_text(encoding='utf-8'))
    segs = timings['segments']

    start = marks.get('title', marks['seg1'])          # video starts at the title card (if any)
    total = min(marks['end'] - start, MAX_TOTAL)
    offsets = [marks[f"seg{s['n']}"] - start for s in segs]

    (work / 'captions.srt').write_text(build_srt(segs, offsets), encoding='utf-8')
    # libass needs a real font file; use the system sans (Segoe UI) from a local fonts dir.
    fonts = work / 'fonts'
    fonts.mkdir(exist_ok=True)
    for name in ('segoeui.ttf', 'seguisb.ttf'):
        src = Path('C:/Windows/Fonts') / name
        if src.exists() and not (fonts / name).exists():
            shutil.copy(src, fonts / name)

    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    cmd = [ffmpeg, '-y', '-hide_banner', '-loglevel', 'error',
           '-ss', f'{start:.3f}', '-i', marks['video']]
    for s in segs:
        cmd += ['-i', str(work / 'audio' / s['mp3'])]
    delays = ';'.join(f"[{i + 1}:a]adelay={int(o * 1000)}:all=1[a{i}]" for i, o in enumerate(offsets))
    mix = ''.join(f'[a{i}]' for i in range(len(segs)))
    filt = (f"[0:v]fps=30,scale=1920:1080,setsar=1,"
            f"subtitles=captions.srt:fontsdir=fonts:force_style='{CAPTION_STYLE}',format=yuv420p[v];"
            f"{delays};{mix}amix=inputs={len(segs)}:normalize=0,apad[a]")
    dest = Path(args.dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    cmd += ['-filter_complex', filt, '-map', '[v]', '-map', '[a]', '-t', f'{total:.3f}',
            '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-r', '30',
            '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-movflags', '+faststart', str(dest)]
    subprocess.run(cmd, cwd=work, check=True)

    dur = media_duration(dest)
    info = subprocess.run([ffmpeg, '-hide_banner', '-i', str(dest)], capture_output=True, text=True).stderr
    streams = re.findall(r'Stream #0:\d.*?: (Video|Audio): (\S+)', info)
    print(f'{dest}  {dur:.2f}s  streams={streams}')
    if dur > MAX_TOTAL + 0.05:
        raise SystemExit(f'too long: {dur:.2f}s')


if __name__ == '__main__':
    main()
