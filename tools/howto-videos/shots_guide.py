"""Fresh screenshots for the role guides, same file names as the stale ones."""
import asyncio, json, os, sys, subprocess, urllib.request, tempfile
HERE = os.path.dirname(os.path.abspath(__file__))
from playwright.async_api import async_playwright
from PIL import Image
B = "http://localhost:8081/"
OUT = os.environ.get("SHOTS_OUT", os.path.join(HERE, "gshots")); os.makedirs(OUT + "/media", exist_ok=True); os.makedirs(OUT + "/img", exist_ok=True)
J, ADMIN, ORG, RILEY = "jordan.ellis@example.com", "morgan.hale@example.org", "dana.whitfield@example.com", "riley.park@example.com"
def sql(q): subprocess.run(["psql", "-h", "/tmp", "-p", "5433", "-U", "postgres", "-d", "hub2", "-qc", q], check=True, capture_output=True)

# name, user, layout, page, steps, target (None = viewport), crop height (css px) for viewport shots
# steps: list of ("click", sel) | ("scroll", sel) | ("fill", sel, value) | ("wait", ms) | ("js", code)
SHOTS = [
    ("media/r-signin-code.webp", None, "phone", "login.html", [("fill", "#login-form input[name=email]", J), ("click", "#btn")], None, 640),
    ("media/r-tour.webp", "sam.okafor@example.com", "phone", "profile.html", [("wait", 800)], "dialog[open]", None),
    ("media/r-home.webp", J, "phone", "profile.html", [("scroll", "h3:has-text('Your trip')")], None, 760),
    ("media/r-invitation.webp", J, "phone", "profile.html", [("scroll", "h4:has-text('Invitation waiting'), :text('Invitation waiting for your answer')")], None, 560),
    ("media/r-weekends.webp", J, "phone", "profile.html", [("js", "document.querySelector('button[aria-label], .wk')"), ("scroll", "h3:has-text('When I can referee')")], None, 820),
    ("media/r-trip.webp", J, "phone", "profile.html", [("scroll", "h3:has-text('Your trip')")], None, 700),
    ("media/r-expense.webp", J, "phone", "profile.html", [("click", "button:has-text('Submit an expense') >> nth=1")], "dialog[open]", None),
    ("media/r-profile.webp", J, "phone", "profile.html", [("click", "button[data-tab=profile]"), ("scroll", "input[name=home_city]")], None, 780),
    ("media/r-email.webp", J, "phone", "profile.html", [("click", "button[data-tab=profile]"), ("click", "a:has-text('Change email')")], "dialog[open]", None),
    ("media/r-tournaments.webp", J, "phone", "profile.html", [("click", "button[data-tab=tournaments]")], None, 820),
    ("media/r-evals.webp", J, "phone", "profile.html", [("click", "button[data-tab=evals]")], None, 820),
    ("media/r-card.webp", None, "phone", "referees.html", [("click", "#tbl tbody tr:has-text('Ellis')")], "dialog[open]", None),
    ("media/r-training.webp", J, "phone", "training.html", [("click", "button[data-tab=practice]"), ("scroll", "#f-rule")], None, 760),
    ("media/r-question.webp", J, "phone", "training.html", [("click", "button:has-text('Team, substitutions, equipment')"), ("click", "#path-detail [data-start] >> nth=0"), ("click", "#quiz-opts button >> nth=0"), ("scroll", "#quiz-q")], None, 760),
    ("media/r-board.webp", J, "phone", "training.html", [("click", "button[data-tab=board]")], None, 760),
    ("media/a-ref-record.webp", ADMIN, "laptop", "admin/index.html#referees", [("click", "tr:has-text('Ellis, Jordan') button:has-text('Open')")], None, None),
    ("media/a-ref-history.webp", ADMIN, "laptop", "admin/index.html#referees", [("click", "tr:has-text('Ellis, Jordan') button:has-text('Open')"), ("scroll", "dialog[open] h3:has-text('Latest evaluations')")], None, None),
    ("media/a-test-dialog.webp", ADMIN, "laptop", "admin/index.html#referees", [("click", "tr:has-text('Ellis, Jordan') button:has-text('Open')"), ("click", "#btn-phys"), ("wait", 500)], None, None),
    ("media/a-card.webp", ADMIN, "laptop", "referees.html", [("click", "#tbl tbody tr:has-text('Ellis')")], None, None),
    ("media/a-staffing.webp", ADMIN, "laptop", "admin/index.html#tournaments", [], None, None),
    ("media/a-staff-settings.webp", ADMIN, "laptop", "admin/index.html#tournaments", [("click", "a:has-text('Change')")], None, None),
    ("media/a-newtour.webp", ADMIN, "laptop", "admin/index.html#tournaments", [("click", "button:has-text('Add tournament')")], None, None),
    ("media/a-officiated.webp", ADMIN, "laptop", "admin/index.html#tournaments", [("click", "button:has-text('Past')"), ("click", "td:has-text('Desert Classic 2026')"), ("wait", 800)], None, None),
    ("media/a-tour-dialog.webp", ADMIN, "laptop", "admin/index.html#tournaments", [("click", "td:has-text('Pacific Coast Open 2027')")], None, None),
    ("img/admin-dashboard.jpg", ADMIN, "laptop", "admin/index.html", [], None, None),
    ("img/admin-find-referees.jpg", ADMIN, "laptop", "admin/index.html#tournaments", [("click", "td:has-text('Pacific Coast Open 2027')"), ("click", "#dlg-tour button:has-text('1. Find and invite')"), ("scroll", "#cand-q")], None, None),
    ("img/admin-invitations.jpg", ADMIN, "laptop", "admin/index.html#tournaments", [("click", "td:has-text('Pacific Coast Open 2027')"), ("click", "#dlg-tour button:has-text('2. Answers')"), ("scroll", "#dlg-tour button:has-text('Send invitations')")], None, None),
    ("img/admin-designated.jpg", ADMIN, "laptop", "admin/index.html#tournaments", [("click", "td:has-text('Rocky Mountain Cup 2027')"), ("click", "#dlg-tour button:has-text('3. Designated')"), ("scroll", "#dlg-tour h3:has-text('USATH pairs'), #dlg-tour :text('USATH pairs')")], None, None),
    ("img/admin-programs.jpg", ADMIN, "laptop", "admin/index.html#programs", [], None, None),
    ("img/organizer-page-designated.jpg", ORG, "phone", "organizer.html", [("scroll", "h2:has-text('Rocky Mountain Cup 2027')")], None, 840),
    ("img/organizer-page.jpg", ORG, "phone", "organizer.html", [("scroll", "h2:has-text('Pacific Coast Open 2027')")], None, 840),
    ("img/organizer-request-form.jpg", None, "phone", "request-referees.html", [("scroll", "h3:has-text('Event')")], None, 840),
    ("img/organizer-token-page.jpg", None, "phone", "TOKEN", [], None, 840),
    ("img/referee-home-trip.jpg", J, "phone", "profile.html", [("scroll", "h3:has-text('Your trip')")], None, 840),
    ("img/referee-home-weekends.jpg", J, "phone", "profile.html", [("scroll", "h3:has-text('When I can referee')")], None, 840),
    ("img/referee-respond.jpg", J, "phone", "profile.html", [("scroll", ":text('Invitation waiting for your answer')")], None, 600),
    ("img/signin-form.jpg", None, "phone", "login.html", [], None, 640),
    ("img/signin-code.jpg", None, "phone", "login.html", [("fill", "#login-form input[name=email]", J), ("click", "#btn")], None, 640),
    ("img/training-quiz-setup.jpg", J, "phone", "training.html", [], None, 840),
    ("img/candidate-home.jpg", RILEY, "phone", "profile.html", [], None, 840),
    ("img/candidate-course.jpg", RILEY, "phone", "training.html#program", [("scroll", "h3:has-text('Level 1 online course')")], None, 840),
    ("img/candidate-module-test.jpg", RILEY, "phone", "training.html#program", [("click", "button:has-text('Module test') >> nth=0"), ("wait", 600)], None, 840),
    ("img/candidate-modules-done.jpg", RILEY, "phone", "training.html#program", [("scroll", "#l1-final")], None, 700),
]

async def shot(p, item):
    name, user, layout, page_path, steps, target, h = item
    phone = layout == "phone"
    ctx = await p.new_context(viewport={"width": 390, "height": 844} if phone else {"width": 1280, "height": 800}, device_scale_factor=2 if phone else 1.25)
    if user:
        s = json.load(urllib.request.urlopen(B + "__session?email=" + user))
        await ctx.add_init_script("localStorage.setItem('sb-localhost-auth-token', %s)" % json.dumps(json.dumps(s)))
    await ctx.add_init_script("try{localStorage.setItem('nrc-admin-layout','laptop')}catch(e){}")
    pg = await ctx.new_page(); pg.set_default_timeout(6000)
    if page_path == "TOKEN":
        import subprocess as sp
        tok = sp.run(["psql", "-h", "/tmp", "-p", "5433", "-U", "postgres", "-d", "hub2", "-tAc", "select organizer_token from tournaments where name='Rocky Mountain Cup 2027'"], capture_output=True, text=True).stdout.strip()
        page_path = "tournament.html?token=" + tok
    await pg.goto(B + page_path); await pg.wait_for_load_state("networkidle"); await pg.wait_for_timeout(900)
    for st in steps:
        try:
            if st[0] == "click": await pg.locator(st[1]).first.click(); await pg.wait_for_timeout(900)
            elif st[0] == "fill": await pg.locator(st[1]).first.fill(st[2])
            elif st[0] == "wait": await pg.wait_for_timeout(st[1])
            elif st[0] == "js": await pg.evaluate(st[1])
            elif st[0] == "scroll":
                await pg.locator(st[1]).first.evaluate("e => { const r = e.getBoundingClientRect(); const sc = (n => { while (n && n !== document.body) { const s = getComputedStyle(n); if (/(auto|scroll)/.test(s.overflowY) && n.scrollHeight > n.clientHeight + 4) return n; n = n.parentElement; } return null })(e.parentElement); if (sc) sc.scrollTop += r.top - sc.getBoundingClientRect().top - 12; else window.scrollTo(0, r.top + scrollY - 76); }")
                await pg.wait_for_timeout(500)
        except Exception as e:
            print("  step fail", name, st, str(e)[:90])
    await pg.evaluate("() => { const f = document.getElementById('fb-btn'); if (f) f.style.display = 'none'; }")
    tmp = os.path.join(tempfile.gettempdir(), "shot.png")
    if target:
        await pg.locator(target).first.screenshot(path=tmp)
    else:
        await pg.screenshot(path=tmp)
        if h:
            im = Image.open(tmp); im.crop((0, 0, im.width, min(im.height, int(h * (2 if phone else 1.25))))).save(tmp)
    im = Image.open(tmp).convert("RGB")
    if phone and im.width > 780: im = im.resize((780, round(im.height * 780 / im.width)), Image.LANCZOS)
    if not phone and im.width > 1600: im = im.resize((1600, round(im.height * 1600 / im.width)), Image.LANCZOS)
    out = f"{OUT}/{name}"
    if name.endswith(".webp"): im.save(out, "WEBP", quality=80)
    else: im.save(out, "JPEG", quality=84, optimize=True)
    print("ok", name, im.size)
    await ctx.close()

async def main(only):
    subprocess.run([os.path.join(HERE, "build_db.sh")], check=True, env={**os.environ, "DB": "hub2", "PORT": "8081"})
    sql("update referees set onboarded_at = null where email = 'sam.okafor@example.com'")
    async with async_playwright() as pw:
        br = await pw.chromium.launch()
        for it in SHOTS:
            if only and not any(o in it[0] for o in only): continue
            try: await shot(br, it)
            except Exception as e: print("FAIL", it[0], str(e)[:150])
        await br.close()
asyncio.run(main(sys.argv[1:]))
