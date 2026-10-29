import asyncio, sys, subprocess, os
HERE = os.path.dirname(os.path.abspath(__file__))
from rec import Rec, poster, reset_db

J = "jordan.ellis@example.com"
ADMIN = "morgan.hale@example.org"
ORG = "dana.whitfield@example.com"
GUEST = "lukas.brandt@example.de"
V = {}
def video(fn): V[fn.__name__] = fn; return fn
def sql(q): subprocess.run(["psql", "-h", os.environ.get("PGHOST", "/tmp"), "-p", os.environ.get("PGPORT", "5433"), "-U", "postgres", "-d", os.environ.get("DB", "hub"), "-qc", q], check=True, capture_output=True)
def next_read(obj):
    import json, urllib.request
    urllib.request.urlopen(urllib.request.Request("http://localhost:8080/__next_read", data=json.dumps(obj).encode(), method="POST"))

async def answer(r, prefix, k, cap=None):
    """Answer one quiz question: first option, Check if several answers, then Next."""
    o = r.page.locator(f"#{prefix}-opts button").nth(k % 2)
    await r.tap(o, cap, wait=900)
    chk = r.page.locator(f"#{prefix}-check")
    if await chk.count() and await chk.is_visible():
        await r.tap(chk, wait=900)
    n = r.page.locator(f"#{prefix}-next")
    if await n.count() and await n.is_visible() and await n.is_enabled():
        await r.tap(n, wait=600)

# ===================== USATH referees (phone) =====================
@video
async def r_signin():
    async with Rec("r-signin", None, start="login.html") as r:
        await r.type("#login-form input[name=email]", J, "Type the email the NRC has for you")
        await r.tap("#btn", "Press Send me a link", wait=1400)
        await r.cap("The email holds a link and a code", 1400)
        r.mark()
        await r.type("#code-form input[name=code]", "48213907", "Click the link, or type the code here")
        await r.tap("#btn-code", "Sign in with the code", wait=300, nav=True)
        await r.cap("You land on your home", 1800)

@video
async def r_tour():
    sql("update referees set onboarded_at = null, phone = null, home_airport_iata = null, usath_member_id = null where email = 'sam.okafor@example.com'")
    async with Rec("r-tour", "sam.okafor@example.com", start="profile.html", keep_tour=True) as r:
        await r.cap("At first sign in, a short welcome tour opens", 1600)
        await r.tap("#tour-next", "Next", wait=900)
        await r.type("#tour-form input[name=phone]", "(510) 555 0187", "Add what USATH does not have", delay=40)
        await r.type("#tour-form input[name=home_airport_iata]", "OAK", delay=80)
        await r.type("#tour-form input[name=usath_member_id]", "US-40377", delay=60)
        r.mark()
        await r.tap("#tour-next", "Save and continue", wait=1200)
        await r.tap("#tour-next", "Availability, invitations, training", wait=1100)
        await r.tap("#tour-next", wait=1100)
        await r.tap("#tour-next", wait=900)
        await r.cap("Replay it any time from Welcome tour", 1600)

@video
async def r_invitation():
    async with Rec("r-invitation", J, start="profile.html") as r:
        await r.cap("An invitation waits on your home")
        await r.point("button:has-text('Accept')")
        r.mark()
        await r.wait(500)
        await r.tap("button:has-text('Accept')", "Accept, Tentative or Decline", wait=1500)
        await r.cap("Done. The NRC then designates the pairs", 1800)

@video
async def r_availability():
    async with Rec("r-availability", J, start="profile.html") as r:
        await r.scroll_to("h3:has-text('When I can referee')", 0.12)
        await r.cap("Tap a weekend to change it", 900)
        b = "button:has-text('Nov 14')"
        await r.tap(b, "One tap: available", wait=900)
        await r.tap("button:has-text('Nov 21')", wait=700)
        await r.tap("button:has-text('Nov 21')", "Tap again: tentative", wait=900)
        await r.tap("button:has-text('Nov 28')", wait=500)
        await r.tap("button:has-text('Nov 28')", wait=500)
        await r.tap("button:has-text('Nov 28')", "Once more: unavailable", wait=1000)
        r.mark()
        await r.cap("Each tap saves", 1000)
        await r.scroll_to("h3:has-text('Other dates')", 0.15)
        await r.cap("Any other dates, weekdays included", 900)
        await r.date("input[name=start_date]", "2026-12-21")
        await r.date("input[name=end_date]", "2026-12-23")
        await r.select("select[name=status]", "unavailable")
        await r.type("#avail-note", "Family trip", delay=45)
        await r.tap("button:has-text('Save these dates')", "Save these dates", wait=1400)
        await r.cap("Mark only the dates you cannot referee at all", 1800)

@video
async def r_trip():
    async with Rec("r-trip", J, start="profile.html") as r:
        await r.cap("Once designated, your next event tops your home", 1500)
        await r.scroll_to("h3:has-text('Your trip')", 0.1)
        await r.cap("Your trip: venue, flights, hotel, references", 1800)
        r.mark()
        await r.glide(260, 1200)
        await r.tap("button:has-text('Add a booking I made')", "Booked something yourself? Add it", wait=900)
        await r.select("dialog[open] select[name=kind]", "car")
        await r.type("dialog[open] input[name=provider]", "Hertz DEN", delay=45)
        await r.type("dialog[open] input[name=reference]", "H48820", delay=45)
        await r.type("dialog[open] input[name=cost]", "112", delay=60)
        await r.tap("dialog[open] button:has-text('Save')", "Save", wait=1300)
        await r.scroll_to("button:has-text('Add to my calendar')", 0.3)
        await r.tap("button:has-text('Add to my calendar')", "Add to my calendar: one file, every booking", wait=1600)

@video
async def r_expense():
    next_read({"is_receipt": True, "category": "car_rental", "merchant": "Hertz", "purchase_date": "2026-10-20", "total_amount": 112.0, "currency": "USD", "nights": None, "description": "Car rental DEN, Jan 22 to 24, prepaid", "confidence": "high"})
    async with Rec("r-expense", J, start="profile.html") as r:
        await r.scroll_to("h3:has-text('Expenses')", 0.1)
        await r.tap("button:has-text('Submit an expense') >> nth=1", "Submit an expense", wait=900)
        await r.cap("Attach the receipt: a photo or a PDF", 600)
        await r.point("dialog[open] input[name=receipt]")
        await r.page.locator("dialog[open] input[name=receipt]").set_input_files(os.path.join(HERE, "receipt-car.jpg"))
        await r.cap("The hub reads it and fills in the fields", 3200)
        r.mark()
        await r.scroll_to("dialog[open] input[name=amount_original]", 0.4)
        await r.cap("Check each field", 1600)
        await r.tap("dialog[open] button:has-text('Submit to the organizer')", "Submit to the organizer", wait=1600)
        await r.cap("The organizer approves and pays; the status shows here", 2200)

@video
async def r_paid():
    async with Rec("r-paid", J, start="profile.html") as r:
        await r.scroll_to("h3:has-text('Expenses')", 0.1)
        await r.tap("button:has-text('How I get paid')", "How I get paid", wait=900)
        await r.type("dialog[open] input[name=venmo]", "@jordan-ellis", "Venmo, PayPal or Zelle", delay=50)
        await r.select("dialog[open] select[name=preferred]", "venmo")
        r.mark()
        await r.cap("Only the organizer who owes you sees it", 1300)
        await r.tap("dialog[open] button:has-text('Save')", "Save", wait=1500)

@video
async def r_profile():
    async with Rec("r-profile", J, start="profile.html") as r:
        await r.tap("button[data-tab=profile]", "Open the Profile tab", wait=1000)
        await r.cap("Photo, phone, club, home and airports", 1000)
        await r.point("#photo-file")
        await r.page.locator("#photo-file").set_input_files(os.path.join(HERE, "avatar.jpg"))
        await r.wait(900)
        await r.type("input[name=departure_airport_iata]", "SFO", "Usual departure airport", delay=90)
        r.mark()
        await r.point("input[name=share_contact]")
        await r.tap("input[name=share_contact]", "Show my email and phone to other referees", wait=800)
        await r.tap("button:has-text('Save profile')", "Save profile", wait=1500)
        await r.scroll_to(":is(a,button):has-text('Change email')", 0.3)
        await r.cap("Your email is your sign in: Change email confirms from both inboxes", 2400)

@video
async def r_history():
    async with Rec("r-history", J, start="profile.html") as r:
        await r.tap("button[data-tab=tournaments]", "Tournaments: every event you refereed", wait=1300)
        await r.tap("text=Desert Classic 2026 >> visible=true", "Open an event for its games", wait=1600)
        await r.glide(300, 1000)
        await r.page.keyboard.press("Escape"); await r.wait(500)
        await r.top(600)
        await r.tap("button[data-tab=games]", "Games: date, teams, partner, score", wait=1700)
        r.mark()
        await r.tap("button[data-tab=evals]", "Evaluations shared with you by the NRC", wait=1800)

@video
async def r_training():
    async with Rec("r-training", J, start="training.html") as r:
        await r.cap("Rules grouped in themed series", 1100)
        await r.glide(380, 900)
        await r.tap("button:has-text('Team, substitutions, equipment')", "Pick a series", wait=1100)
        await r.tap("#path-detail [data-start] >> nth=0", "Start a lesson", wait=1200)
        r.mark()
        for k in range(3):
            try: await answer(r, "quiz", k, "Answer, then read why" if k == 0 else None)
            except Exception as e: print("training", str(e)[:120]); break
        end = r.page.locator("button:has-text('End session')").first
        if await end.count() and await end.is_visible(): await r.tap(end, "End the session when you want", wait=1400)
        await r.top(700)
        await r.glide(380, 900)
        await r.cap("Each card shows completion, score and date", 2000)

@video
async def r_directory():
    async with Rec("r-directory", J, start="directory.html") as r:
        await r.cap("Signed in referees can reach each other", 1200)
        await r.type("input[type=search], input#q, input[name=q]", "Okafor", "Search a name or a city", delay=70)
        await r.wait(1200)
        await r.cap("Contact details show only for referees who opted in", 2000)
        r.mark()


@video
async def r_assessment():
    async with Rec("r-assessment", J, start="training.html#program") as r:
        await r.cap("Certified referees: the initial assessment comes first", 1600)
        await r.scroll_to("#start", 0.4)
        await r.cap("50 questions at your level, 60 minutes, one sitting", 1500)
        r.mark()
        await r.tap("#start", "Start the assessment", wait=1500)
        for k in range(3):
            try: await answer(r, "pq", k, "Tick your answer, then Next" if k == 0 else None)
            except Exception as e: print("assess", str(e)[:120]); break
        await r.cap("Score 80% or more with no rule under 80%: done", 1800)
        await r.cap("Otherwise a 12 week program on the rules you missed", 1800)

@video
async def r_candidate():
    async with Rec("r-candidate", "riley.park@example.com", start="training.html#program") as r:
        await r.cap("New referees: the Level 1 online course", 1500)
        await r.scroll_to("#l1-start", 0.35)
        await r.cap("Pick a start date: study sessions go to your calendar", 1500)
        r.mark()
        await r.tap("#l1-plan", "Save plan and download calendar", wait=1300)
        await r.scroll_to("h3:has-text('Modules')", 0.1)
        await r.tap("button:has-text('Study') >> nth=0", "Study each module, card by card", wait=1300)
        await r.tap("#sc-next", wait=1000)
        await r.tap("#sc-next", wait=1000)
        await r.tap("#sc-done", "Done studying, take the module test", wait=1300)
        for k in range(3):
            try: await answer(r, "pq", k)
            except Exception as e: print("cand", str(e)[:100]); break
        await r.cap("Pass every module, then the 30 question final test", 2000)

# ===================== Visitors (phone) =====================
@video
async def v_become():
    async with Rec("v-become", None, start="become-a-referee.html") as r:
        await r.cap("What Level 1 takes, step by step", 1300)
        await r.glide(700, 1100); await r.glide(900, 1200)
        await r.top(700)
        await r.tap("button:has-text('I want to be contacted') >> nth=0", "Press I want to be contacted", wait=900)
        await r.type("dialog[open] input[name=first_name]", "Alex", delay=50)
        await r.type("dialog[open] input[name=last_name]", "Rivera", delay=50)
        await r.type("dialog[open] input[name=email]", "alex.rivera@example.com", delay=30)
        await r.type("dialog[open] input[name=city]", "San Jose", delay=40)
        await r.type("dialog[open] input[name=state]", "CA", delay=60)
        await r.select("dialog[open] select[name=club_affiliation]", label="Yes, I am a member of a club")
        await r.select("dialog[open] select[name=background]", label="Former player")
        await r.select("dialog[open] select[name=availability]", label="Weekends")
        r.mark()
        await r.tap("#contact-btn", "Send to the NRC", wait=1600)
        await r.cap("The NRC contacts you and sets you up", 1800)

@video
async def v_try():
    async with Rec("v-try", None, start="try.html") as r:
        await r.cap("Ten questions on real game situations", 1200)
        await r.tap("#btn-start", "Start the 10 questions", wait=1100)
        for k in range(10):
            try: await answer(r, "quiz", k, "Pick an answer, read why" if k == 0 else None)
            except Exception as e: print("try", k, str(e)[:120]); break
        await r.cap("Your result, and how to become a referee", 2200)
        r.mark()
        await r.glide(400, 1200)

@video
async def v_referees():
    async with Rec("v-referees", None, start="referees.html") as r:
        await r.cap("Every certified USATH referee", 1300)
        await r.type("#q", "CA", "Search a name, club or state", delay=120)
        await r.wait(900)
        await r.tap("#tbl tbody tr >> nth=0", "Open a referee", wait=1800)
        r.mark()
        await r.cap("Photo, club, tournaments. No contact details, no level", 2200)

@video
async def v_practice():
    async with Rec("v-practice", None, start="training.html") as r:
        await r.cap("Train on the IHF rules, no account needed", 1300)
        await r.tap("button[data-tab=practice]", "Free quiz", wait=1100)
        await r.scroll_to("#f-rule", 0.3)
        await r.select("#f-rule", label="Rule 8: Fouls and unsportsmanlike conduct", cap="Pick a rule, or all of them")
        await r.tap("#btn-start", "Start the practice", wait=1300)
        r.mark()
        for k in range(3):
            try: await answer(r, "quiz", k)
            except Exception as e: print("practice", str(e)[:100]); break
        await r.cap("Sign in to keep your scores", 1800)

# ===================== Guest referees (phone) =====================
@video
async def g_welcome():
    async with Rec("g-welcome", GUEST, start="profile.html") as r:
        await r.cap("Named by the organizer: your first sign in", 1500)
        await r.type("dialog[open] input[name=phone]", "+49 221 555 0142", "A few details for travel", delay=40)
        await r.scroll_to("dialog[open] select[name=nation], dialog[open] select[name=country], dialog[open] input[name=home_airport_iata]", 0.4)
        await r.type("dialog[open] input[name=home_airport_iata]", "CGN", delay=90)
        r.mark()
        await r.select("dialog[open] select:has(option:has-text('Germany'))", contains="Germany", cap="The nation you referee for")
        sv = r.page.locator("dialog[open] button:has-text('Save')").first
        await r.tap(sv, "Save", wait=1500)
        await r.cap("Your events, your profile, training", 1800)

@video
async def g_event():
    async with Rec("g-event", GUEST, start="profile.html") as r:
        later = r.page.locator("#gp-later")
        if await later.is_visible(): await later.click(); await r.wait(500)
        await r.cap("Your event: dates, venue, organizer", 1500)
        await r.glide(320, 1300)
        await r.cap("The pairs designated and what the organizer covers", 1800)
        r.mark()
        await r.glide(360, 1300)
        await r.tap("button:has-text('Add to my calendar')", "Add to my calendar", wait=1300)
        await r.tap("button:has-text('Add a booking I made')", "Record a flight you booked", wait=900)
        await r.select("dialog[open] select[name=kind]", "flight")
        await r.type("dialog[open] input[name=provider]", "Lufthansa LH 458", delay=35)
        await r.type("dialog[open] input[name=reference]", "LX7P2Q", delay=45)
        await r.tap("dialog[open] button:has-text('Save')", "Save", wait=1500)

@video
async def g_expense():
    next_read({"is_receipt": True, "category": "airfare", "merchant": "Lufthansa", "purchase_date": "2026-10-15", "total_amount": 640.0, "currency": "EUR", "nights": None, "description": "CGN to SJC via FRA, round trip", "confidence": "high"})
    async with Rec("g-expense", GUEST, start="profile.html") as r:
        later = r.page.locator("#gp-later")
        if await later.is_visible(): await later.click(); await r.wait(500)
        await r.scroll_to("button:has-text('Submit an expense')", 0.4)
        await r.tap("button:has-text('Submit an expense')", "Submit an expense", wait=900)
        await r.point("dialog[open] input[name=receipt]")
        await r.page.locator("dialog[open] input[name=receipt]").set_input_files(os.path.join(HERE, "receipt-eur.jpg"))
        await r.cap("The hub reads the receipt, euros included", 3000)
        await r.scroll_to("dialog[open] input[name=currency]", 0.4)
        await r.cap("Converted to USD at the 30 day average rate", 1800)
        r.mark()
        await r.tap("dialog[open] button:has-text('Submit to the organizer')", "Submit to the organizer", wait=1600)
        await r.cap("The organizer approves and pays you", 1800)

@video
async def g_training():
    async with Rec("g-training", GUEST, start="profile.html") as r:
        later = r.page.locator("#gp-later")
        if await later.is_visible(): await later.click(); await r.wait(500)
        await r.tap("button:has-text('Training and tests')", "Training and tests: optional", wait=1500)
        await r.glide(300, 1200)
        r.mark()
        await r.cap("Any test is open to you; none is required", 1800)


# ===================== Organizers (phone) =====================
@video
async def o_request():
    async with Rec("o-request", None, start="request-referees.html") as r:
        await r.cap("No account needed to send a request", 1300)
        await r.type("input[name=name]", "Golden State Cup 2027", "Name the event", delay=35)
        await r.type("input[name=games_expected]", "24", delay=80)
        await r.select("#club-sel", contains="Bay City Handball Club", cap="Pick the hosting USATH club")
        await r.tap("input[name=divisions][value='Senior-M']", "Tick the divisions", wait=300)
        await r.tap("input[name=divisions][value='Senior-W']", wait=300)
        await r.date("input[name=start_date]", "2027-04-17", "Dates")
        await r.date("input[name=end_date]", "2027-04-18")
        await r.type("input[name=pairs_total]", "2", "Pairs required in total", delay=80)
        await r.cap("Pairs you bring from outside the US go here", 1300)
        r.mark()
        await r.type("input[name=venue_name]", "Bay City Sports Center", "Venue", delay=25)
        await r.type("input[name=nearest_airport_iata]", "SJC", delay=70)
        await r.type("input[name=venue_city]", "San Jose", delay=35)
        await r.type("input[name=venue_state]", "CA", delay=70)
        await r.type("input[name=hotel_nights_covered]", "2", "What you cover: told to the referees word for word", delay=80)
        await r.type("input[name=food_stipend_per_day]", "40", delay=80)
        await r.scroll_to("select[name=travel_managed_by]", 0.3)
        await r.cap("Who books flights, hotel and car", 1400)
        await r.type("input[name=organizer_name]", "Dana Whitfield", "Your contact: the email is your sign in", delay=30)
        await r.type("input[name=organizer_email]", "dana.whitfield@example.com", delay=22)
        await r.tap("button:has-text('Submit request')", "Submit request", wait=1800)
        await r.cap("The NRC is notified; sign in to follow it", 2000)

@video
async def o_follow():
    async with Rec("o-follow", ORG, start="organizer.html") as r:
        await r.cap("My tournaments: one card per request", 1400)
        await r.scroll_to("h2:has-text('Pacific Coast Open 2027')", 0.08)
        await r.cap("Where it stands: received, reviewing, designated", 1800)
        await r.glide(300, 1100)
        await r.cap("Referees designated, pairs from USATH and yours", 1800)
        r.mark()
        await r.scroll_to("h2:has-text('Rocky Mountain Cup 2027')", 0.08)
        await r.cap("Once designated: names, where they fly from, bookings", 1700)
        await r.glide(520, 1400)
        await r.cap("You also get an email with the list", 1700)

@video
async def o_pairs():
    sql("delete from assignments where guest_official_id is not null; delete from guest_officials;")
    async with Rec("o-pairs", ORG, start="organizer.html") as r:
        await r.cap("Bringing a pair from outside the US? It is your pair", 1500)
        b = r.page.locator("button:has-text('Name a pair'), button:has-text('Name an organizer pair')").first
        await r.tap(b, "Press Name a pair", wait=1000)
        await r.select("dialog[open] select >> nth=0", contains="Germany", cap="Nation and federation")
        await r.type("dialog[open] input[name=a_first]", "Lukas", "Both referees: name, email, home airport", delay=30)
        await r.type("dialog[open] input[name=a_last]", "Brandt", delay=30)
        await r.type("dialog[open] input[name=a_email]", "lukas.brandt@example.de", delay=25)
        await r.type("dialog[open] input[name=a_iata]", "CGN", delay=60)
        await r.type("dialog[open] input[name=b_first]", "Jonas", delay=30)
        await r.type("dialog[open] input[name=b_last]", "Weber", delay=30)
        await r.type("dialog[open] input[name=b_email]", "jonas.weber@example.de", delay=25)
        await r.type("dialog[open] input[name=b_iata]", "CGN", delay=60)
        r.mark()
        await r.type("dialog[open] input[name=payment_notes]", "Club pays by bank transfer", "How you reimburse them", delay=30)
        await r.cap("Each gets a sign in link to their own page", 1400)
        await r.tap("dialog[open] button:has-text('Save')", "Save", wait=1700)

@video
async def o_booking():
    async with Rec("o-booking", ORG, start="organizer.html") as r:
        await r.cap("You book? Record it under the official", 1400)
        await r.scroll_to("button:has-text('Add a booking we made') >> nth=0", 0.4)
        await r.tap("button:has-text('Add a booking we made') >> nth=0", "Add a booking we made", wait=900)
        await r.select("dialog[open] select[name=kind]", "hotel")
        await r.type("dialog[open] input[name=provider]", "Hyatt Place San Jose", delay=30)
        await r.type("dialog[open] input[name=reference]", "HP-77310", delay=40)
        await r.type("dialog[open] input[name=cost]", "389", delay=70)
        await r.date("dialog[open] input[name=start_at]", "2027-03-12T15:00")
        await r.date("dialog[open] input[name=end_at]", "2027-03-14T11:00")
        r.mark()
        await r.tap("dialog[open] button:has-text('Save')", "Save: the referee sees it at once", wait=1700)

@video
async def o_expenses():
    async with Rec("o-expenses", ORG, start="organizer.html") as r:
        await r.cap("You approve and pay the expenses of your event", 1500)
        await r.scroll_to("button:has-text('Open reimbursements') >> nth=1", 0.3)
        await r.tap("button:has-text('Open reimbursements') >> nth=1", "Open reimbursements", wait=1300)
        await r.cap("Totals, by category, by official, every receipt", 1800)
        r.mark()
        await r.glide(420, 1300)
        await r.glide(380, 1300)
        await r.tap("button:has-text('Approve all within the agreement')", "Approve all within the agreement", wait=1500)
        await r.cap("Others one by one; a decline needs a reason", 1600)
        dl = r.page.locator("button:has-text('Download receipts')").first
        await r.tap(dl, "Download receipts: one zip with a summary", wait=1600)
        mp = r.page.locator("button:has-text('Mark paid')").first
        if await mp.count():
            await r.tap(mp, "Mark paid once you paid them", wait=1300)

@video
async def o_edit():
    async with Rec("o-edit", ORG, start="organizer.html") as r:
        await r.scroll_to("button:has-text('Edit the request') >> nth=0", 0.4)
        await r.tap("button:has-text('Edit the request') >> nth=0", "Edit the request", wait=1300)
        await r.cap("Every field opens; Save and notify tells the NRC and the referees", 2200)
        r.mark()
        await r.page.keyboard.press("Escape"); await r.wait(600)
        await r.point("button:has-text('Duplicate as a new request') >> nth=0")
        await r.cap("Duplicate for next year: the form opens prefilled", 1800)
        await r.point("button:has-text('Cancel the event') >> nth=0")
        await r.cap("Cancel the event asks you to confirm first", 1800)

@video
async def o_report():
    async with Rec("o-report", ORG, start="organizer.html") as r:
        await r.scroll_to("h2:has-text('Desert Classic 2026')", 0.08)
        await r.tap("button:has-text('Post event report')", "After the event: the two minute report", wait=1100)
        await r.type("input[name=games_played]", "12", delay=80)
        await r.select("select[name=referee_rating]", "5", cap="How the referees did")
        await r.type("textarea[name=highlights]", "Calm, consistent, good communication with the bench.", delay=18)
        r.mark()
        await r.tap("button:has-text('Send the report')", "Send the report", wait=1700)


# ===================== NRC admins (laptop) =====================
A = dict(mobile=False)
async def open_tour(r, name, cap=None):
    await r.tap(f"td:has-text('{name}')", cap, wait=1300)

@video
async def a_dashboard():
    async with Rec("a-dashboard", ADMIN, start="admin/index.html", **A) as r:
        await r.cap("The dashboard: what is due, then the key figures", 1600)
        r.mark()
        await r.point("#pane-dashboard .stat >> nth=0"); await r.wait(500)
        await r.cap("Each figure opens the list behind it", 1400)
        await r.tap(".admin-nav .sec-top:has-text('Referees')", "Menu in three sections: Referees, Events, Training", wait=700)
        await r.tap(".admin-nav .sec-top:has-text('Events')", wait=700)
        await r.tap(".admin-nav .sec-top:has-text('Training')", wait=900)
        await r.tap("button[data-view=phone]", "Phone layout for the console on the go", wait=1600)
        await r.tap("button[data-view=laptop]", "Back to laptop", wait=1300)

@video
async def a_roster():
    async with Rec("a-roster", ADMIN, start="admin/index.html#referees", **A) as r:
        await r.cap("The roster, alphabetical by last name", 1300)
        await r.select("#r-level", label="Level 2", cap="Filter by level or sign in status", wait=900)
        await r.tap("#ref-all", "Tick the referees to write to", wait=500)
        await r.tap("#btn-ref-email", "Email selected", wait=900)
        await r.type("dialog[open] input[name=subject]", "Pacific Coast Open: please declare your availability", delay=18)
        await r.cap("{first_name} fills in per referee; Send me a test first", 2000)
        r.mark()
        await r.tap("dialog[open] button:has-text('Cancel')", wait=700)
        await r.select("#r-level", label="All levels", wait=700)
        await r.tap("button:has-text('Open') >> nth=2", "Open a referee record", wait=1300)
        await r.scroll_to("dialog[open] summary:has-text('Change history')", 0.4)
        await r.cap("Who changed what and when, field by field", 1800)

@video
async def a_test():
    async with Rec("a-test", ADMIN, start="admin/index.html#referees", **A) as r:
        await r.tap("button:has-text('Open') >> nth=2", "Open the referee record", wait=1300)
        await r.scroll_to("#btn-phys", 0.5)
        await r.tap("#btn-phys", "Record physical test", wait=1100)
        await r.select("#form-test select[name=std_band]", "M30", cap="Shuttle run: the standard for age and gender")
        await r.type("#form-test input[name=beep_level]", "9", "Level, shuttle, total loops", delay=90)
        await r.type("#form-test input[name=beep_shuttle]", "4", delay=90)
        await r.type("#form-test input[name=beep_loops]", "76", delay=90)
        await r.cap("Pass is calculated from the age and gender standard", 1700)
        r.mark()
        sv = r.page.locator("#form-test button:has-text('Save')").last
        await r.tap(sv, "Save", wait=1500)

@video
async def a_invite():
    async with Rec("a-invite", ADMIN, start="admin/index.html#tournaments", **A) as r:
        await r.cap("Tournaments: filters with counts", 1300)
        await r.tap("button:has-text('Nobody designated')", wait=900)
        await open_tour(r, "Pacific Coast Open 2027", "Open the event")
        await r.tap("#dlg-tour button:has-text('1. Find and invite')", "1. Find and invite", wait=1100)
        await r.cap("Ranked by declared availability, airport, then level", 1800)
        r.mark()
        await r.tap("#dlg-tour tr:has(:text-is('Bello, Aisha')) input[type=checkbox]", "Tick a referee: the partner comes too", wait=900)
        await r.tap("#dlg-tour button:has-text('Add selected as draft invitations')", "Add selected as draft invitations", wait=1300)
        await r.tap("#dlg-tour button:has-text('2. Answers')", "2. Answers: the drafts", wait=900)
        drafts = r.page.locator("#dlg-tour tr:has(span:has-text('draft')) input[type=checkbox]")
        n = await drafts.count()
        for i in range(n): await r.tap(drafts.nth(i), wait=300)
        await r.tap("#dlg-tour button:has-text('Send invitations')", "Send invitations: email and home page", wait=1800)

@video
async def a_designate():
    sql("update assignment_requests set status = 'accepted', responded_at = now() where referee_id = (select id from referees where email = 'jordan.ellis@example.com') and tournament_id = (select id from tournaments where name = 'Pacific Coast Open 2027')")
    async with Rec("a-designate", ADMIN, start="admin/index.html#tournaments", **A) as r:
        await open_tour(r, "Pacific Coast Open 2027", "Open the event")
        await r.tap("#dlg-tour button:has-text('2. Answers')", "2. Answers", wait=1000)
        for who in ("Ellis, Jordan", "Okafor, Sam"):
            await r.tap(f"#dlg-tour tr:has(:text-is('{who}')) input[type=checkbox]", "Tick the accepted pair" if who.startswith("Ellis") else None, wait=400)
        await r.tap("#dlg-tour button:has-text('Designate accepted')", "Designate accepted: count and pairs are checked", wait=2000)
        await r.cap("Each referee gets the brief; the weekend is booked", 1800)
        r.mark()
        await r.tap("#dlg-tour button:has-text('3. Designated')", "3. Designated pairs and travel", wait=1400)
        await r.tap("#dlg-tour button:has-text('2. Answers')", wait=900)
        await r.tap("#btn-organizer", "Notify organizer: the list and a link to their page", wait=1800)

@video
async def a_outside():
    async with Rec("a-outside", ADMIN, start="admin/index.html#tournaments", **A) as r:
        await open_tour(r, "Pacific Coast Open 2027", "Open the event")
        await r.tap("#dlg-tour button:has-text('2. Answers')", "A yes by phone or email?", wait=1000)
        await r.tap("#dlg-tour tr:has(:text-is('Raghunathan, Priya')) input[type=checkbox]", "Tick the referee", wait=500)
        await r.tap("#dlg-tour button:has-text('Designate, accepted outside the hub')", "Designate, accepted outside the hub", wait=1500)
        box = r.page.locator("dialog[open] textarea, dialog[open] input[type=text]").last
        if await box.count() and await box.is_visible():
            await r.type(box, "Phone call with Priya on Oct 28", "Say how and when they accepted", delay=30)
            r.mark()
            ok = r.page.locator("dialog[open] button:has-text('Designate'), dialog[open] button:has-text('Confirm'), dialog[open] button:has-text('Save')").last
            await r.tap(ok, wait=1600)
        await r.cap("The email quotes your note and asks to reply if wrong", 2000)

@video
async def a_override():
    async with Rec("a-override", ADMIN, start="admin/index.html#tournaments", **A) as r:
        await open_tour(r, "Pacific Coast Open 2027", "Open the event")
        await r.tap("#dlg-tour button:has-text('1. Find and invite')", "Hidden as unavailable: named above the list", wait=1200)
        ov = r.page.locator("#dlg-tour button:has-text('Override')").first
        r.mark()
        await r.tap(ov, "Override, for this tournament only", wait=1000)
        box = r.page.locator("dialog[open] textarea").last
        if await box.count():
            await r.type(box, "Your blocked dates were meant for the Seattle Cup. Can you referee the Pacific Coast Open?", "Give the reason in a full sentence", delay=14)
            snd = r.page.locator("dialog[open] button:has-text('Send'), dialog[open] button:has-text('Override')").last
            await r.tap(snd, "The referee accepts or reverts from the email", wait=1800)

@video
async def a_travel():
    async with Rec("a-travel", ADMIN, start="admin/index.html#tournaments", **A) as r:
        await open_tour(r, "Rocky Mountain Cup 2027", "Open a staffed event")
        await r.tap("#dlg-tour button:has-text('3. Designated')", "3. Designated pairs and travel", wait=1300)
        await r.scroll_to("#dlg-tour button:has-text('Add booking') >> nth=1", 0.5)
        await r.tap("#dlg-tour button:has-text('Add booking') >> nth=1", "Add booking under an official", wait=1000)
        await r.select("dialog[open] select[name=kind]", "flight")
        await r.type("dialog[open] input[name=provider]", "Southwest WN 2215", delay=30)
        await r.type("dialog[open] input[name=reference]", "SW8KQ2", delay=45)
        await r.type("dialog[open] input[name=cost]", "241", delay=70)
        r.mark()
        sv = r.page.locator("dialog[open] button:has-text('Save')").last
        await r.tap(sv, "Save: the referee and the organizer see it", wait=1600)
        b = r.page.locator("#dlg-tour button:has-text('Send brief')").first
        if await b.count():
            await r.scroll_to(b, 0.5); await r.point(b)
            await r.cap("Send brief to all designated after any change", 1800)

@video
async def a_expenses():
    async with Rec("a-expenses", ADMIN, start="admin/index.html#tournaments", **A) as r:
        await open_tour(r, "Rocky Mountain Cup 2027", "Open the event")
        await r.tap("#dlg-tour summary:has-text('Expenses')", "Expenses: exactly what the organizer sees", wait=1300)
        await r.glide(380, 1300)
        await r.cap("Bookings by payer, claims by status, by category", 1800)
        r.mark()
        await r.glide(420, 1300)
        await r.cap("Approval sits with the organizer; the NRC can step in", 2000)

@video
async def a_addtour():
    async with Rec("a-addtour", ADMIN, start="admin/index.html#tournaments", **A) as r:
        await r.tap("button:has-text('Add tournament')", "Add an event that did not come through the form", wait=1000)
        await r.type("dialog[open] input[name=name]", "NORCAL Championship 2027", delay=30)
        await r.select("dialog[open] select[name=sanction]", "regional")
        await r.date("dialog[open] input[name=start_date]", "2027-05-01")
        await r.date("dialog[open] input[name=end_date]", "2027-05-02")
        await r.type("dialog[open] input[name=venue_city]", "Sacramento", delay=35)
        await r.type("dialog[open] input[name=venue_state]", "CA", delay=70)
        await r.select("dialog[open] select[name=club_id]", contains="Bay City Handball Club", cap="Hosting club and divisions")
        await r.tap("dialog[open] input[name=divisions][value='Senior-M']", wait=300)
        r.mark()
        await r.tap("dialog[open] button:has-text('Save and open')", "Save and open", wait=1800)

# ===================== runner =====================
async def main(names):
    for n in names:
        if n not in V: print("unknown", n); continue
        reset_db()
        try:
            await V[n]()
            poster(n.replace("_", "-"))
        except Exception as e:
            print("ERROR", n, str(e)[:400])

asyncio.run(main(sys.argv[1:] or list(V)))
