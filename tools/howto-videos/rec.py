"""Recorder for the hub how-to videos: crisp screencast frames, a visible pointer with a tap ring,
and a caption chip per step. Output: <name>.mp4 (H.264) and <name>.webp poster."""
import asyncio, json, os, shutil, subprocess, urllib.request, base64, time, tempfile
from playwright.async_api import async_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
B = os.environ.get("BASE", "http://localhost:8080/")
OUT = os.environ.get("OUT", os.path.join(HERE, "out"))
os.makedirs(OUT, exist_ok=True)

OVERLAY = r"""
(() => {
  const css = `#__ov{position:fixed;inset:0;width:100vw;height:100vh;margin:0;padding:0;border:0;background:transparent;overflow:visible;pointer-events:none;z-index:2147483647}
  #__cur{position:fixed;left:0;top:0;width:26px;height:26px;margin:-13px 0 0 -13px;border-radius:50%;background:rgba(232,225,58,.62);border:2.5px solid #0c2448;box-shadow:0 0 0 2px rgba(255,255,255,.9),0 2px 8px rgba(0,0,0,.35);z-index:2147483647;pointer-events:none;transition:transform .12s}
  #__cur.down{transform:scale(.72)}
  .__ring{position:fixed;width:26px;height:26px;margin:-13px 0 0 -13px;border-radius:50%;border:3px solid #c8102e;z-index:2147483646;pointer-events:none;animation:__r .55s ease-out forwards}
  @keyframes __r{from{transform:scale(.6);opacity:1}to{transform:scale(2.6);opacity:0}}
  #__cap{position:fixed;left:50%;bottom:14px;transform:translateX(-50%) translateY(12px);max-width:86%;background:rgba(12,24,48,.92);color:#fff;font:600 14px/1.3 Barlow,Arial,sans-serif;padding:7px 14px;border-radius:999px;z-index:2147483647;pointer-events:none;opacity:0;transition:opacity .25s,transform .25s;text-align:center;box-shadow:0 4px 18px rgba(0,0,0,.3)}
  #__cap.on{opacity:1;transform:translateX(-50%) translateY(0)}`;
  const boot = () => {
    if (document.getElementById('__cur')) return;
    const st = document.createElement('style'); st.textContent = css; document.documentElement.appendChild(st);
    const ov = document.createElement('div'); ov.id = '__ov'; ov.setAttribute('popover', 'manual'); document.documentElement.appendChild(ov);
    const c = document.createElement('div'); c.id = '__cur'; ov.appendChild(c);
    const cap = document.createElement('div'); cap.id = '__cap'; ov.appendChild(cap);
    const front = () => { try { if (ov.matches(':popover-open')) ov.hidePopover(); ov.showPopover(); } catch (e) {} };
    front(); window.__front = front;
    new MutationObserver(() => front()).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['open'] });
    let pos = {x: innerWidth * .5, y: innerHeight * .55}; try { pos = JSON.parse(sessionStorage.getItem('__pos')) || pos; } catch (e) {}
    c.style.left = pos.x + 'px'; c.style.top = pos.y + 'px';
    try { const k = sessionStorage.getItem('__capt'); if (k) { cap.textContent = k; cap.classList.add('on'); } } catch (e) {}
    window.__curMove = (x, y, ms) => new Promise(res => { front();
      const sx = parseFloat(c.style.left), sy = parseFloat(c.style.top), t0 = performance.now();
      const step = (t) => { const k = Math.min(1, (t - t0) / ms), e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        c.style.left = (sx + (x - sx) * e) + 'px'; c.style.top = (sy + (y - sy) * e) + 'px';
        if (k < 1) requestAnimationFrame(step); else { try { sessionStorage.setItem('__pos', JSON.stringify({x, y})); } catch (e) {} res(); } };
      requestAnimationFrame(step);
    });
    window.__curClick = () => { c.classList.add('down'); setTimeout(() => c.classList.remove('down'), 160);
      const r = document.createElement('div'); r.className = '__ring'; r.style.left = c.style.left; r.style.top = c.style.top; ov.appendChild(r); setTimeout(() => r.remove(), 700); };
    window.__cap = (t) => { try { t ? sessionStorage.setItem('__capt', t) : sessionStorage.removeItem('__capt'); } catch (e) {}
      if (!t) { cap.classList.remove('on'); return; } cap.classList.remove('on'); setTimeout(() => { cap.textContent = t; cap.classList.add('on'); }, 120); };
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
"""


class Rec:
    def __init__(self, name, email=None, mobile=True, start="", hold=900, keep_tour=False, extra_init=None):
        self.name, self.email, self.mobile, self.start, self.hold = name, email, mobile, start, hold
        self.keep_tour, self.extra_init = keep_tour, extra_init
        self.frames = []
        self.prompt_text = "Agreed by phone with the referee on Oct 28"

    async def __aenter__(self):
        self.pw = await async_playwright().start()
        self.br = await self.pw.chromium.launch()
        vw = {"width": 390, "height": 844} if self.mobile else {"width": 1280, "height": 800}
        self.vw = vw
        self.dsf = 2 if self.mobile else 1.5
        self.ctx = await self.br.new_context(viewport=vw, device_scale_factor=self.dsf, locale="en-US", timezone_id="America/Los_Angeles",
                                             accept_downloads=True)
        if self.email:
            s = json.load(urllib.request.urlopen(B + "__session?email=" + self.email))
            await self.ctx.add_init_script("try{localStorage.setItem('sb-localhost-auth-token', %s)}catch(e){}" % json.dumps(json.dumps(s)))
        if not self.keep_tour:
            await self.ctx.add_init_script("try{for(const k of ['nrc-tour-done','nrc-tour-seen','nrc-welcome-done','nrc-onboard-done']) localStorage.setItem(k,'1')}catch(e){}")
        if self.extra_init:
            await self.ctx.add_init_script(self.extra_init)
        await self.ctx.add_init_script(OVERLAY)
        # keep real names out of the demo: the app's own example text names the NRC chair
        await self.ctx.add_init_script("""new MutationObserver(() => { document.querySelectorAll('[placeholder*="Forsthoefel"]').forEach(e => e.placeholder = e.placeholder.replace(/Joshua Forsthoefel/g, 'Alex Grant')); }).observe(document.documentElement, { subtree: true, childList: true });""")
        self.page = await self.ctx.new_page()
        self.page.set_default_timeout(8000)
        self.page.on("dialog", lambda d: asyncio.ensure_future(d.accept(self.prompt_text) if d.type == "prompt" else d.accept()))
        self.cdp = await self.ctx.new_cdp_session(self.page)
        self.cdp.on("Page.screencastFrame", self._frame)
        if self.start is not None:
            await self.page.goto(B + self.start)
            await self.page.wait_for_load_state("networkidle")
            await self.page.wait_for_timeout(600)
        self.t0 = time.monotonic(); self.poster_t = None
        await self.cdp.send("Page.startScreencast", {"format": "jpeg", "quality": 90, "maxWidth": int(vw["width"] * self.dsf), "maxHeight": int(vw["height"] * self.dsf), "everyNthFrame": 1})
        await self.page.wait_for_timeout(self.hold)
        return self

    def _frame(self, ev):
        self.frames.append((ev["metadata"]["timestamp"], ev["data"]))
        asyncio.ensure_future(self.cdp.send("Page.screencastFrameAck", {"sessionId": ev["sessionId"]}))

    async def __aexit__(self, et, e, tb):
        await self.page.wait_for_timeout(1200)
        try: await self.cdp.send("Page.stopScreencast")
        except Exception: pass
        await self.ctx.close(); await self.br.close(); await self.pw.stop()
        if et:
            print("FAILED", self.name, e)
        self._encode()
        return False

    def _encode(self):
        d = os.path.join(tempfile.gettempdir(), f"frames-{self.name}"); shutil.rmtree(d, ignore_errors=True); os.makedirs(d)
        fr = sorted(self.frames, key=lambda x: x[0])
        if len(fr) < 2:
            print("no frames", self.name); return
        lines = []
        for i, (ts, data) in enumerate(fr):
            p = f"{d}/f{i:05d}.jpg"; open(p, "wb").write(base64.b64decode(data))
            dur = (fr[i + 1][0] - ts) if i + 1 < len(fr) else 1.0
            lines.append(f"file '{p}'\nduration {max(dur, 0.001):.4f}")
        lines.append(f"file '{d}/f{len(fr) - 1:05d}.jpg'")
        open(f"{d}/list.txt", "w").write("\n".join(lines))
        w = self.vw["width"] * (2 if self.mobile else 1.5); h = self.vw["height"] * (2 if self.mobile else 1.5)
        # phone: 780x1688 frames scaled to 540 wide; laptop: 1920x1200 scaled to 1440 wide
        scale = "scale=540:-2:flags=lanczos" if self.mobile else "scale=1440:-2:flags=lanczos"
        mp4 = f"{OUT}/{self.name}.mp4"
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", f"{d}/list.txt", "-vf", f"{scale},fps=30,format=yuv420p",
                        "-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-movflags", "+faststart", "-an", mp4], check=True)
        dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", mp4], capture_output=True, text=True).stdout.strip() or 0)
        shutil.rmtree(d, ignore_errors=True)
        if self.poster_t is not None: open(f"{OUT}/{self.name}.poster", "w").write(f"{self.poster_t:.2f}")
        elif os.path.exists(f"{OUT}/{self.name}.poster"): os.remove(f"{OUT}/{self.name}.poster")
        print(f"recorded {self.name}: {dur:.1f}s {os.path.getsize(mp4) // 1024} KB")

    def mark(self):
        """Use the current frame as the poster."""
        self.poster_t = time.monotonic() - self.t0

    # ---------- actions ----------
    def L(self, sel):
        return self.page.locator(sel).first if isinstance(sel, str) else sel

    async def cap(self, text, wait=700):
        await self.page.evaluate("t => window.__cap && window.__cap(t)", text)
        await self.page.wait_for_timeout(wait)

    async def wait(self, ms):
        await self.page.wait_for_timeout(ms)

    async def scroll_to(self, sel, frac=0.35):
        loc = self.L(sel)
        await loc.wait_for(state="visible")
        y = await loc.evaluate("(e, f) => { const r = e.getBoundingClientRect(); const top = r.top + scrollY; return { top, vis: r.top > 70 && r.bottom < innerHeight - 70 } }", frac)
        if not y["vis"]:
            await loc.evaluate("(e, f) => { const sc = (n => { while (n && n !== document.body) { const s = getComputedStyle(n); if (/(auto|scroll)/.test(s.overflowY) && n.scrollHeight > n.clientHeight + 4) return n; n = n.parentElement; } return null })(e.parentElement); const r = e.getBoundingClientRect(); if (sc) { const cr = sc.getBoundingClientRect(); sc.scrollTo({ top: sc.scrollTop + r.top - cr.top - cr.height * f, behavior: 'smooth' }); } else window.scrollTo({ top: r.top + scrollY - innerHeight * f, behavior: 'smooth' }) }", frac)
            await self.page.wait_for_timeout(800)
        return loc

    async def point(self, sel, ms=600):
        loc = await self.scroll_to(sel)
        b = await loc.bounding_box()
        await self.page.evaluate("([x,y,ms]) => window.__curMove && window.__curMove(x,y,ms)", [b["x"] + b["width"] / 2, b["y"] + b["height"] / 2, ms])
        await self.page.wait_for_timeout(ms + 120)
        return loc

    async def tap(self, sel, cap=None, wait=1000, nav=False):
        if cap: await self.cap(cap, 500)
        loc = await self.point(sel)
        await self.page.evaluate("() => window.__curClick && window.__curClick()")
        await self.page.wait_for_timeout(180)
        if nav:
            async with self.page.expect_navigation():
                await loc.click()
            await self.page.wait_for_load_state("networkidle")
        else:
            await loc.click()
        await self.page.wait_for_timeout(wait)
        return loc

    async def type(self, sel, text, cap=None, delay=55, clear=True, wait=400):
        loc = await self.tap(sel, cap, wait=200)
        if clear: await loc.fill("")
        await loc.press_sequentially(text, delay=delay)
        await self.page.wait_for_timeout(wait)
        return loc

    async def select(self, sel, value=None, label=None, cap=None, wait=700, contains=None):
        loc = await self.tap(sel, cap, wait=250)
        if contains:
            v = await loc.evaluate("(e, t) => { const o = [...e.options].find(o => o.textContent.includes(t)); return o ? o.value : null }", contains)
            await loc.select_option(v)
        elif label: await loc.select_option(label=label)
        else: await loc.select_option(value)
        await self.page.wait_for_timeout(wait)
        return loc

    async def date(self, sel, iso, cap=None, wait=600):
        loc = await self.tap(sel, cap, wait=250)
        await loc.fill(iso)
        await self.page.wait_for_timeout(wait)
        return loc

    async def goto(self, path, wait=900):
        await self.page.goto(B + path); await self.page.wait_for_load_state("networkidle"); await self.page.wait_for_timeout(wait)

    async def glide(self, dy, ms=900):
        await self.page.evaluate("dy => window.scrollBy({top: dy, behavior: 'smooth'})", dy)
        await self.page.wait_for_timeout(ms)

    async def top(self, ms=800):
        await self.page.evaluate("() => window.scrollTo({top: 0, behavior: 'smooth'})"); await self.page.wait_for_timeout(ms)


def poster(name, at=None):
    """Poster frame: by default 60% through the clip."""
    mp4 = f"{OUT}/{name}.mp4"
    dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", mp4], capture_output=True, text=True).stdout.strip())
    pf = f"{OUT}/{name}.poster"
    t = at if at is not None else (float(open(pf).read()) + 0.3 if os.path.exists(pf) else dur * 0.45)
    t = min(t, dur - 0.2)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-ss", f"{t:.2f}", "-i", mp4, "-frames:v", "1", "-c:v", "libwebp", "-quality", "78", f"{OUT}/{name}.webp"], check=True)


def reset_db():
    subprocess.run([os.path.join(HERE, "build_db.sh")], check=True)
