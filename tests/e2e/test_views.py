"""דשבורד, מצב הצגה, השוואה בין שנים, גאנט."""
import re
from playwright.sync_api import expect
from conftest import shot, api, goto_tab


def test_dashboard_year_switch_and_table_view(admin_page):
    p = admin_page
    goto_tab(p, "dash")
    for y in ["2025", "2026", "2027"]:
        p.click(f"[data-dy='{y}']")
        doc = api(p, "GET", f"year/{y}")["data"]
        done = sum(1 for r in doc["rows"] if r["status"] == "הסתיים")
        pct = int(done / len(doc["rows"]) * 100 + 0.5)  # same rounding as JS Math.round
        expect(p.locator(".hero-num")).to_have_text(f"{pct}%")
        expect(p.locator("#ch-sec .hb-row")).to_have_count(len(doc["sections"]))
    p.click("[data-tbl='ch-sec']")
    expect(p.locator("#ch-sec .dtbl")).to_be_visible()
    expect(p.locator("#ch-sec .dchart")).to_be_hidden()
    p.hover("#ch-month .seg >> nth=0")
    expect(p.locator("#dtip")).to_have_css("opacity", "1")
    shot(p, "dashboard", full_page=True)


def test_presentation_navigation(admin_page):
    p = admin_page
    goto_tab(p, "dash")
    p.click("#presentBtn")
    expect(p.locator(".slide")).to_be_visible()
    total = int(p.locator(".pr-count").inner_text().split("/")[1])
    doc = api(p, "GET", "year/" + p.locator(".pr-year").input_value())["data"]
    assert total == len(doc["sections"]) + 5
    p.keyboard.press("ArrowLeft")
    expect(p.locator(".pr-count")).to_have_text(f"2 / {total}")
    shot(p, "presentation")
    p.keyboard.press("ArrowRight")
    expect(p.locator(".pr-count")).to_have_text(f"1 / {total}")
    p.keyboard.press("Escape")
    expect(p.locator(".present")).to_have_count(0)


def test_compare_lists_all_years(admin_page):
    p = admin_page
    goto_tab(p, "compare")
    expect(p.locator(".cmp-cards .kpi")).to_have_count(3)


def test_gantt_bars_filters_and_date_range(admin_page):
    p = admin_page
    goto_tab(p, "gantt")
    p.click("[data-gy='2027']")
    expect(p.locator(".g-bar").first).to_be_visible()
    total = p.locator(".g-bar").count()
    assert total > 10
    # section filter
    p.select_option("#gSec", index=3)
    sec_bars = p.locator(".g-bar").count()
    assert 0 < sec_bars < total
    p.select_option("#gSec", "")
    # set an exact range on a task -> bar spans ~Feb 10 to May 20 (100 days of 365)
    bar = p.locator(".g-bar").first
    rid = bar.get_attribute("data-id")
    bar.click()
    p.fill("[name=startDate]", "2027-02-10")
    p.fill("[name=endDate]", "2027-05-20")
    p.click("[data-save]")
    expect(p.locator(".drawer")).to_have_count(0)
    nb = p.locator(f".g-bar[data-id='{rid}']")
    expect(nb).to_have_count(1)
    expected = 100 / 365 * 100  # Feb 10 – May 20 inclusive = 100 days
    p.wait_for_function("([id, w]) => { const e = document.querySelector(`.g-bar[data-id='${id}']`); return e && Math.abs(parseFloat(e.style.width) - w) < 0.5; }", arg=[rid, expected])
    expect(p.locator("nav.tabs button[data-v='gantt']")).to_have_class(re.compile("active"))  # stayed on gantt
    # invalid range is rejected with a message
    nb.click()
    p.fill("[name=startDate]", "2027-06-01")
    p.fill("[name=endDate]", "2027-05-01")
    p.click("[data-save]")
    expect(p.locator("#toast")).to_contain_text("תאריך הסיום לפני")
    p.keyboard.press("Escape")
    shot(p, "gantt")


def test_gantt_undated_list_opens_task(admin_page):
    p = admin_page
    goto_tab(p, "gantt")
    p.click("[data-gy='2026']")
    und = p.locator(".g-undated")
    if und.count():
        und.locator("summary").click()
        und.locator("li").first.click()
        expect(p.locator(".drawer")).to_be_visible()
