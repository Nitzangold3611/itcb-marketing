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


def _money(rows, k):
    import re as _re
    tot = 0
    for r in rows:
        t = _re.sub(r"[,\s₪]|ש״ח|ש\"ח", "", str(r.get(k) or ""))
        if _re.fullmatch(r"-?\d+(\.\d+)?", t):
            tot += float(t)
    return round(tot)


def _shekel(n):
    return ("−" if n < 0 else "") + "₪" + f"{abs(round(n)):,}"


def test_dashboard_money_cards_and_year_chart(admin_page):
    p = admin_page
    # give 2025 a budget and an expense so the chart has real differences between years
    rid = api(p, "GET", "year/2025")["data"]["rows"][0]["id"]
    assert api(p, "PUT", f"year/2025/row/{rid}", {"budget": "4000", "expense": "1500"})["status"] == 200
    goto_tab(p, "dash")
    years = api(p, "GET", "years")["data"]["years"]
    for y in years:
        p.click(f"[data-dy='{y}']")
        rows = api(p, "GET", f"year/{y}")["data"]["rows"]
        for k in ("budget", "expense", "income"):
            expect(p.locator(f".kpi.money[data-k={k}] .val")).to_have_text(_shekel(_money(rows, k)))
    # change vs previous year is shown from the 2nd year on
    expect(p.locator(".kpi.money[data-k=budget] .delta-line")).to_contain_text(f"לעומת {years[-2]}")
    # chart: one bar (or zero-line) per year x 3 measures, selected year highlighted
    expect(p.locator("#ch-money [data-mtip]")).to_have_count(len(years) * 3)
    expect(p.locator("#ch-money .ax-on")).to_have_text(years[-1])
    p.hover("#ch-money path[data-mtip] >> nth=0")
    expect(p.locator("#dtip")).to_contain_text("₪")
    shot(p, "dashboard-money", full_page=True)
    p.click("[data-tbl='ch-money']")
    expect(p.locator("#ch-money .dtbl tbody tr")).to_have_count(len(years))
    first = api(p, "GET", f"year/{years[0]}")["data"]["rows"]
    expect(p.locator("#ch-money .dtbl tbody tr").first.locator("td").nth(1)).to_have_text(_shekel(_money(first, "budget")))


def test_compare_shows_money_per_year(admin_page):
    p = admin_page
    goto_tab(p, "compare")
    years = api(p, "GET", "years")["data"]["years"]
    for i, y in enumerate(years):
        rows = api(p, "GET", f"year/{y}")["data"]["rows"]
        card = p.locator(".cmp-cards .kpi").nth(i)
        for k in ("budget", "expense", "income"):
            expect(card.locator(f".cmp-money [data-k={k}] b")).to_have_text(_shekel(_money(rows, k)))
    expect(p.locator("#cmpMoney tbody tr")).to_have_count(len(years))
    shot(p, "compare-money", full_page=True)


def _seed_money_by_priority(p):
    """Give one task of every priority (and one without) a budget/expense/income in each year."""
    for y in api(p, "GET", "years")["data"]["years"]:
        seen = set()
        for r in api(p, "GET", f"year/{y}")["data"]["rows"]:
            key = r.get("priority") or "none"
            if key in seen:
                continue
            seen.add(key)
            n = len(seen)
            assert api(p, "PUT", f"year/{y}/row/{r['id']}", {"budget": str(1000 * n), "expense": str(100 * n), "income": str(10 * n)})["status"] == 200


def _rows_for(p, y, prio):
    rows = api(p, "GET", f"year/{y}")["data"]["rows"]
    if prio == "none":
        return [r for r in rows if not r.get("priority")]
    return [r for r in rows if not prio or str(r.get("priority")) == prio]


def test_dashboard_money_filter_by_priority(admin_page):
    p = admin_page
    _seed_money_by_priority(p)
    goto_tab(p, "dash")
    years = api(p, "GET", "years")["data"]["years"]
    y = years[-1]
    p.click(f"[data-dy='{y}']")
    opts = p.locator("[data-mprio] option").evaluate_all("os => os.map(o => o.value)")
    assert opts[0] == "" and "1" in opts and opts[-1] == "none", opts
    for prio in [o for o in opts if o] + [""]:
        p.select_option("[data-mprio]", prio)
        rows = _rows_for(p, y, prio)
        for k in ("budget", "expense", "income"):
            expect(p.locator(f".kpi.money[data-k={k}] .val")).to_have_text(_shekel(_money(rows, k)))
        # the per-year chart/table follows the same filter
        p.click("[data-tbl='ch-money']")
        first = _rows_for(p, years[0], prio)
        expect(p.locator("#ch-money .dtbl tbody tr").first.locator("td").nth(1)).to_have_text(_shekel(_money(first, "budget")))
        p.click("[data-tbl='ch-money']")
        if prio == "1":
            expect(p.locator(".money-head h2")).to_contain_text("קדימות 1 בלבד")
            shot(p, "dashboard-money-priority-1", full_page=True)
    expect(p.locator(".money-head h2")).not_to_contain_text("בלבד")


def test_money_priority_choice_is_shared_and_remembered(admin_page):
    p = admin_page
    _seed_money_by_priority(p)
    goto_tab(p, "dash")
    p.select_option("[data-mprio]", "2")
    goto_tab(p, "compare")
    expect(p.locator("#cmpMoney [data-mprio]")).to_have_value("2")
    years = api(p, "GET", "years")["data"]["years"]
    for i, y in enumerate(years):
        rows = _rows_for(p, y, "2")
        expect(p.locator("#cmpMoney tbody tr").nth(i).locator("td").nth(1)).to_have_text(_shekel(_money(rows, "budget")))
        expect(p.locator(".cmp-cards .kpi").nth(i).locator(".cmp-money [data-k=expense] b")).to_have_text(_shekel(_money(rows, "expense")))
    shot(p, "compare-money-priority-2", full_page=True)
    p.reload()
    p.wait_for_selector("#cmpMoney")
    expect(p.locator("#cmpMoney [data-mprio]")).to_have_value("2")
    p.select_option("#cmpMoney [data-mprio]", "")
    rows = _rows_for(p, years[0], "")
    expect(p.locator("#cmpMoney tbody tr").first.locator("td").nth(1)).to_have_text(_shekel(_money(rows, "budget")))


def test_money_breakdown_section_task_detail(admin_page):
    p = admin_page
    _seed_money_by_priority(p)
    goto_tab(p, "dash")
    y = api(p, "GET", "years")["data"]["years"][-1]
    p.click(f"[data-dy='{y}']")
    p.select_option("[data-mprio]", "")
    doc = api(p, "GET", f"year/{y}")["data"]
    tree = p.locator("#moneyTree")
    # level 1: every section that has money, with the section total
    sec_with_money = [(i, s) for i, s in enumerate(doc["sections"]) if any(_money([r], k) for r in doc["rows"] if r["sectionId"] == s["id"] for k in ("budget", "expense", "income"))]
    expect(tree.locator("tr.lv1")).to_have_count(len(sec_with_money))
    expect(tree.locator("tr.lv2:visible")).to_have_count(0)          # closed by default
    i, sec = sec_with_money[0]
    srows = [r for r in doc["rows"] if r["sectionId"] == sec["id"]]
    l1 = tree.locator("tr.lv1").first
    expect(l1.locator("td").nth(1)).to_have_text(_shekel(_money(srows, "budget")))
    expect(l1.locator("td").nth(2)).to_have_text(_shekel(_money(srows, "expense")) if _money(srows, "expense") else "—")
    # level 2: open the section -> its tasks with task totals
    l1.locator("[data-tg]").click()
    l2 = tree.locator("tr.lv2:visible").first
    expect(l2).to_be_visible()
    tname = l2.get_attribute("data-name")
    trows = [r for r in srows if ((r.get("task") or "").strip() or "(ללא שם משימה)") == tname]
    expect(l2.locator("td").nth(1)).to_have_text(_shekel(_money(trows, "budget")))
    # level 3: open the task -> its details, each with its own amounts
    l2.locator("[data-tg]").click()
    l3 = tree.locator("tr.lv3:visible")
    expect(l3.first).to_be_visible()
    rid = l3.first.get_attribute("data-row")
    r = next(x for x in doc["rows"] if x["id"] == rid)
    expect(l3.first.locator("td").nth(1)).to_have_text(_shekel(_money([r], "budget")))
    # the details of a task add up to the task, the tasks to the section, the sections to the year
    foot = tree.locator("tfoot td")
    expect(foot.nth(1)).to_have_text(_shekel(_money(doc["rows"], "budget")))
    shot(p, "money-breakdown", full_page=True)
    # clicking a detail opens the task for editing; a change there updates the tree
    l3.first.click()
    expect(p.locator(".drawer")).to_be_visible()
    p.fill("[name=budget]", "777")
    p.click("[data-save]")
    expect(tree.locator(f"tr.lv3[data-row='{rid}'] td").nth(1)).to_have_text("₪777")
    # open/close all
    tree.locator("[data-tree=close]").click()
    expect(tree.locator("tr.lv3:visible")).to_have_count(0)
    tree.locator("[data-tree=open]").click()
    assert tree.locator("tr.lv3:visible").count() > 1


def test_money_breakdown_follows_priority_and_show_all(admin_page):
    p = admin_page
    _seed_money_by_priority(p)
    goto_tab(p, "dash")
    y = api(p, "GET", "years")["data"]["years"][-1]
    p.click(f"[data-dy='{y}']")
    p.select_option("[data-mprio]", "2")
    tree = p.locator("#moneyTree")
    rows = _rows_for(p, y, "2")
    expect(tree.locator("tfoot td").nth(1)).to_have_text(_shekel(_money(rows, "budget")))
    tree.locator("[data-tree=open]").click()
    for rid in tree.locator("tr.lv3").evaluate_all("els => els.map(e => e.dataset.row)"):
        assert any(r["id"] == rid for r in rows), "a task of another priority is listed"
    p.select_option("[data-mprio]", "")
    doc = api(p, "GET", f"year/{y}")["data"]
    tree.locator("[data-tree=all]").check()
    expect(tree.locator("tr.lv1")).to_have_count(len(doc["sections"]))
    tree.locator("[data-tree=open]").click()
    expect(tree.locator("tr.lv3")).to_have_count(len(doc["rows"]))
