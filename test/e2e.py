import json, sys, io
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from playwright.sync_api import sync_playwright
from PIL import Image

OUT = "/tmp/claude-0/shots"
NZ = ZoneInfo("Pacific/Auckland")
today = datetime.now(NZ).date()

def mock_weather():
    days = [today + timedelta(days=i) for i in range(-2, 7)]
    times, temp, feels, rain, cloud, wind, wdir, gust, pres = [], [], [], [], [], [], [], [], []
    for di, d in enumerate(days):
        for h in range(24):
            times.append(f"{d.isoformat()}T{h:02d}:00")
            temp.append(round(6 + 10 * max(0, 1 - abs(h - 15) / 9), 1))
            feels.append(round(4 + 10 * max(0, 1 - abs(h - 15) / 9), 1))
            rain.append(10 if di != 6 else 80)
            cloud.append(20 + (h % 5) * 8)
            wind.append(6 + h * 0.6)
            wdir.append(315)
            gust.append(12 + h)
            pres.append(1018 - di * 0.2)
    return {
        "hourly": {"time": times, "temperature_2m": temp, "apparent_temperature": feels, "precipitation_probability": rain,
                   "cloud_cover": cloud, "wind_speed_10m": wind, "wind_direction_10m": wdir, "wind_gusts_10m": gust, "pressure_msl": pres},
        "daily": {"time": [d.isoformat() for d in days],
                  "sunrise": [f"{d.isoformat()}T06:15" for d in days], "sunset": [f"{d.isoformat()}T19:50" for d in days],
                  "temperature_2m_max": [17] * len(days), "temperature_2m_min": [5] * len(days)},
    }

buf = io.BytesIO()
Image.new("RGB", (3000, 2000), (40, 120, 140)).save(buf, "JPEG")
open("/tmp/claude-0/shots/fish.jpg", "wb").write(buf.getvalue())

errors = []
with sync_playwright() as p:
    b = p.chromium.launch()
    def page_for(viewport, mobile=False):
        ctx = b.new_context(viewport=viewport, is_mobile=mobile, has_touch=mobile, timezone_id="UTC", permissions=["geolocation"],
                            geolocation={"latitude": -44.19, "longitude": 170.14})
        ctx.route("**/api.open-meteo.com/**", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(mock_weather())))
        ctx.route("**/fonts.googleapis.com/**", lambda r: r.abort())
        ctx.route("**/fonts.gstatic.com/**", lambda r: r.abort())
        ctx.route("**/unpkg.com/**", lambda r: r.abort())
        pg = ctx.new_page()
        pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.on("console", lambda m: m.type == "error" and "ERR_FAILED" not in m.text and "Failed to load resource" not in m.text and errors.append(m.text))
        return pg

    # ---------- phone ----------
    pg = page_for({"width": 390, "height": 844}, mobile=True)
    pg.goto("http://localhost:8899/")
    pg.wait_for_selector(".outlook")
    pg.screenshot(path=f"{OUT}/phone-today.png", full_page=True)
    print("today headline:", pg.inner_text(".headline"), "| score:", pg.inner_text(".score"))
    assert pg.locator("a.btn.primary:has-text('Meridian')").get_attribute("href").startswith("https://www.meridianenergy.co.nz/")
    rows = pg.locator(".weekrow")
    print("week rows:", rows.count(), "| picks:", pg.locator(".pick").all_inner_texts())
    assert rows.count() == 7
    pg.locator(".weekrow").nth(3).click()
    pg.wait_for_selector(".daylabel h1")
    print("jumped to:", pg.inner_text(".daylabel h1"), "| selected row:", pg.locator(".weekrow.sel .wd").inner_text().replace("\n"," "))
    pg.screenshot(path=f"{OUT}/phone-week.png", full_page=True)
    pg.locator(".weekrow").nth(0).click()
    print("windows:", pg.locator(".timerow .num").all_inner_texts())

    # day navigation
    pg.click("[data-action=day][data-v='1']")
    print("day label after next:", pg.inner_text(".daylabel h1"))
    pg.click("[data-action=day][data-v='-1']")

    # protected route redirects to auth
    pg.click(".tab:has-text('Log')")
    pg.wait_for_selector("[data-form=auth]")
    # sign up
    pg.click("[data-action=auth-mode][data-v=up]")
    pg.fill("#a-name", "Olly"); pg.fill("#a-email", "olly@example.nz"); pg.fill("#a-pass", "short")
    pg.click("[data-form=auth] button[type=submit]")
    pg.wait_for_selector(".formerr:has-text('8 characters')")
    pg.fill("#a-pass", "correct horse battery"); 
    pg.click("[data-form=auth] button[type=submit]")
    pg.wait_for_selector(".catch-list")
    print("after signup route:", pg.evaluate("location.hash"))
    pg.screenshot(path=f"{OUT}/phone-log-empty.png", full_page=True)

    # add a catch with a photo
    pg.click(".fab")
    pg.wait_for_selector("form[data-form=catch]")
    pg.set_input_files("#photoInput", "/tmp/claude-0/shots/fish.jpg")
    pg.wait_for_selector(".pthumb")
    pg.click("[data-action=pick][data-k=species][data-v='Brown trout']")
    pg.fill("#len", "54"); pg.fill("#wt", "2.1")
    pg.fill("#lname", "Black Toby"); pg.fill("#lsize", "18 g"); pg.fill("#lcol", "Silver / black")
    pg.fill("#spotname", "Below the control gates")
    pg.fill("#notes", "Slow retrieve along the far wall.")
    pg.wait_for_timeout(300)
    print("conditions chips:", pg.locator("#condBox .chip").all_inner_texts())
    pg.screenshot(path=f"{OUT}/phone-add.png", full_page=True)
    pg.click(".savebar button[type=submit]")
    pg.wait_for_selector(".catch")
    print("log card:", pg.inner_text(".catch .species"), "|", pg.inner_text(".catch .size"))
    assert pg.locator(".catch img.thumb").count() == 1, "photo thumb missing"
    # the photo really loads
    ok = pg.evaluate("() => new Promise(r => { const i = document.querySelector('.catch img.thumb'); if (i.complete) r(i.naturalWidth); else i.onload = () => r(i.naturalWidth); })")
    print("thumb natural width:", ok)
    assert ok > 0 and ok <= 1600
    assert pg.inner_text(".stats .stat:nth-child(3) b") == "Black Toby", pg.inner_text(".stats .stat:nth-child(3) b")
    pg.screenshot(path=f"{OUT}/phone-log.png", full_page=True)

    # detail + edit + private flag
    pg.click(".catch")
    pg.wait_for_selector(".facts")
    pg.screenshot(path=f"{OUT}/phone-detail.png", full_page=True)
    pg.click("a:has-text('Edit')")
    pg.wait_for_selector("form[data-form=catch]")
    pg.fill("#len", "56")
    pg.check("input[data-field=private]")
    pg.click(".savebar button[type=submit]")
    pg.wait_for_selector(".catch")
    print("after edit:", pg.inner_text(".catch .size"), "|", pg.inner_text(".catch .muted.num"))

    # account page + logout
    pg.click(".acct")
    pg.wait_for_selector(".account-grid")
    pg.screenshot(path=f"{OUT}/phone-account.png", full_page=True)

    # ---------- desktop ----------
    d = page_for({"width": 1360, "height": 900})
    d.goto("http://localhost:8899/")
    d.wait_for_selector(".outlook")
    d.screenshot(path=f"{OUT}/desktop-today.png", full_page=True)
    d.click("a.btn:has-text('Sign in')")
    d.fill("#a-email", "olly@example.nz"); d.fill("#a-pass", "correct horse battery")
    d.click("[data-form=auth] button[type=submit]")
    d.wait_for_selector(".catch-list, .side .mini, .side .muted")
    d.goto("http://localhost:8899/#/today")
    d.wait_for_selector(".side .mini")
    d.screenshot(path=f"{OUT}/desktop-today-signedin.png", full_page=True)
    d.goto("http://localhost:8899/#/log")
    d.wait_for_selector(".catch")
    d.screenshot(path=f"{OUT}/desktop-log.png", full_page=True)
    d.goto("http://localhost:8899/#/add")
    d.wait_for_selector("form[data-form=catch]")
    d.screenshot(path=f"{OUT}/desktop-add.png", full_page=True)

    # manifest + sw reachable
    print("manifest:", d.evaluate("fetch('/manifest.webmanifest').then(r=>r.status)"), "sw:", d.evaluate("fetch('/sw.js').then(r=>r.status)"))
    b.close()

print("JS errors:", errors)
sys.exit(1 if errors else 0)
