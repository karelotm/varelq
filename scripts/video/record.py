"""Record the scripted VARELQ walkthrough with Playwright (1920x1080, light theme).

Needs a running VARELQ server with recorded demo data (see README.md) and the
timings.json written by tts.py. Every screen is held for its segment's audio
duration + pad. Non-GET requests are aborted, so the recording can never start a
run or write a decision.

Writes to <workdir>:
  raw/<id>.webm   the Playwright recording
  marks.json      seconds from recording start at which the title card and each segment begin
  shots/segN.png  one screenshot per segment, taken near the end of its hold

Usage: python record.py --out <workdir> [--url http://127.0.0.1:8396/]
"""
import argparse
import json
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

CASE_REF = 'INV-0142'   # three-way case: 200 invoiced vs 180 received
SCENARIO = 'S4'         # guard lab scenario: baseline 5/5 unsafe vs guarded 0/5

TITLE_HTML = """
<div id="vq-title" style="position:fixed;inset:0;z-index:9999;background:#faf9f5;display:flex;
  flex-direction:column;align-items:center;justify-content:center;transition:opacity .45s ease;">
  <div style="font-family:'Source Serif 4',Georgia,serif;font-size:120px;font-weight:500;line-height:1.15;color:#1f1e1d;letter-spacing:2px">VARELQ</div>
  <div style="font-family:'IBM Plex Sans',sans-serif;font-size:40px;line-height:1.3;color:#5e5d59;margin-top:22px">evidence before decisions</div>
</div>"""

SMOOTH_SCROLL_JS = """([y, ms]) => new Promise(done => {
  const from = window.scrollY, to = Math.max(0, Math.min(y, document.documentElement.scrollHeight - innerHeight));
  const t0 = performance.now();
  const ease = t => t < .5 ? 2*t*t : 1 - Math.pow(-2*t + 2, 2) / 2;
  (function step(now) {
    const k = Math.min(1, (now - t0) / ms);
    window.scrollTo(0, from + (to - from) * ease(k));
    k < 1 ? requestAnimationFrame(step) : done();
  })(t0);
})"""


class Walkthrough:
    def __init__(self, page, timings, shots: Path, case_id=None):
        self.case_id = case_id
        self.page = page
        self.segs = {s['n']: s for s in timings['segments']}
        self.title_card = timings['title_card']
        self.shots = shots
        self.t0 = time.monotonic()
        self.marks = {}

    def now(self):
        return time.monotonic() - self.t0

    def begin(self, n):
        self.marks[f'seg{n}'] = round(self.now(), 3)
        return self.marks[f'seg{n}'] + self.segs[n]['hold']

    def hold_until(self, end, n=None):
        """Wait until `end`; take the segment screenshot 0.5 s before it."""
        if n is not None:
            self.page.wait_for_timeout(max(0, (end - 0.5 - self.now()) * 1000))
            self.page.screenshot(path=str(self.shots / f'seg{n}.png'))
        self.page.wait_for_timeout(max(0, (end - self.now()) * 1000))

    def at(self, start, frac, n):
        """Wait until a fraction of segment n's hold has elapsed."""
        self.page.wait_for_timeout(max(0, (start + frac * self.segs[n]['hold'] - self.now()) * 1000))

    def scroll_to(self, y, ms=1200):
        self.page.evaluate(SMOOTH_SCROLL_JS, [y, ms])

    def scroll_into_view(self, selector, offset=120, ms=1200):
        y = self.page.evaluate('([s, o]) => { const e = document.querySelector(s); return e ? e.getBoundingClientRect().top + scrollY - o : scrollY; }', [selector, offset])
        self.scroll_to(y, ms)

    def go(self, hash_, wait_for):
        self.page.evaluate('h => { location.hash = h; }', hash_)
        self.page.wait_for_selector(wait_for, timeout=15000)
        self.page.wait_for_timeout(250)  # let the view paint

    def run(self):
        p = self.page
        # Title card over the loaded overview, then fade it out.
        if self.title_card:
            p.evaluate('html => document.body.insertAdjacentHTML("beforeend", html)', TITLE_HTML)
            p.wait_for_timeout(300)
            self.marks['title'] = round(self.now(), 3)
            p.wait_for_timeout(self.title_card * 1000 - 450)
            p.evaluate('document.getElementById("vq-title").style.opacity = 0')
            p.wait_for_timeout(450)

        # 1. Overview
        end = self.begin(1)
        self.hold_until(end, 1)
        if self.title_card:
            p.evaluate('document.getElementById("vq-title").remove()')

        # 2. Agent reliability: findings table, R1 selected, priority formula in the side panel
        start = self.now(); end = self.begin(2)
        p.click('a[data-nav="reliability"]')
        p.wait_for_selector('.rl-row[data-group]')
        p.wait_for_timeout(600)
        self.at(start, 0.30, 2)
        p.click('.rl-row[data-group]')           # top finding (R1)
        p.wait_for_selector('.rl-side .rl-formula-lg')
        self.at(start, 0.88, 2)
        self.scroll_to(160, 900)                  # keep the priority line in view
        self.hold_until(end, 2)

        # 3. Trace inspector: open the first R1 occurrence, flagged step in view
        start = self.now(); end = self.begin(3)
        self.scroll_into_view('.rl-occ', offset=300, ms=900)
        p.wait_for_timeout(700)
        p.click('.rl-occ')
        p.wait_for_selector('.rl-flag[data-flag-index]', timeout=15000)
        p.wait_for_timeout(900)
        self.hold_until(end, 3)

        # 4. Guard lab: S4 baseline 5/5 unsafe vs guarded 0/5
        start = self.now(); end = self.begin(4)
        p.click('a[data-nav="lab"]')
        p.wait_for_selector('[data-scenario]')
        if p.get_attribute(f'[data-scenario="{SCENARIO}"]', 'aria-checked') != 'true':
            p.click(f'[data-scenario="{SCENARIO}"]')
            p.wait_for_timeout(800)
        self.at(start, 0.35, 4)
        self.scroll_to(430, 1800)                 # before/after strip + baseline vs guarded panels
        self.hold_until(end, 4)

        # 5. Case view: INV-0142 three-way check, opened from the overview's case list
        start = self.now(); end = self.begin(5)
        self.scroll_to(0, 500)
        if self.case_id:
            self.go(f'#cases/{self.case_id}', 'text=Invoiced vs received')
        else:
            p.click('a[data-nav="overview"]')
            p.wait_for_selector(f'text={CASE_REF}')
            p.wait_for_timeout(700)
            p.click(f'tr:has-text("{CASE_REF}"), a:has-text("{CASE_REF}")')
            p.wait_for_selector('text=Invoiced vs received')
        # stay on the Invoice tab: its footer shows the OCR provenance (provider, GPU, latency)
        self.hold_until(end, 5)

        # 6. Close on the overview: top pattern, S4 5/5 -> 0/5, cases
        start = self.now(); end = self.begin(6)
        p.click('a[data-nav="overview"]')
        p.wait_for_selector(f'text={CASE_REF}')
        # one quick glance at the shell: the Ctrl+K search palette
        self.at(start, 0.35, 6)
        p.keyboard.press('Control+K')
        p.wait_for_timeout(2200)
        p.screenshot(path=str(self.shots / 'seg6-palette.png'))
        p.keyboard.press('Escape')
        p.evaluate('document.activeElement && document.activeElement.blur()')  # no focus ring on the close
        self.hold_until(end, 6)
        self.marks['end'] = round(self.now(), 3)
        return self.marks


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--url', default='http://127.0.0.1:8396/', help='base URL of the VARELQ app')
    ap.add_argument('--case-id', help='case run to open in segment 5 (default: click INV-0142 on the overview)')
    args = ap.parse_args()
    out = Path(args.out)
    timings = json.loads((out / 'audio' / 'timings.json').read_text(encoding='utf-8'))
    (out / 'shots').mkdir(parents=True, exist_ok=True)
    raw = out / 'raw'
    raw.mkdir(exist_ok=True)
    for old in raw.glob('*.webm'):
        old.unlink()

    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        ctx = browser.new_context(viewport={'width': 1920, 'height': 1080}, color_scheme='light',
                                  record_video_dir=str(raw), record_video_size={'width': 1920, 'height': 1080})
        ctx.add_init_script("localStorage.setItem('varelq.preferences', JSON.stringify({theme:'light',density:'comfortable',motion:'full'}))")
        ctx.route('**/*', lambda r: r.abort() if r.request.method != 'GET' else r.continue_())
        page = ctx.new_page()
        walk = Walkthrough(page, timings, out / 'shots', args.case_id)   # t0 ~ start of the video
        page.goto(args.url + '#overview')
        page.wait_for_selector(f'text={CASE_REF}')
        page.evaluate('document.fonts.ready')
        skip = page.locator('button:has-text("Skip")')   # first-visit tour, if the build has one
        if skip.count():
            skip.first.click()
            page.wait_for_timeout(400)
        marks = walk.run()
        video = page.video.path()
        ctx.close()
        browser.close()

    marks['video'] = str(Path(video).resolve())
    (out / 'marks.json').write_text(json.dumps(marks, indent=2), encoding='utf-8')
    print(json.dumps(marks, indent=2))


if __name__ == '__main__':
    main()
