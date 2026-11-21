"""לשוניות השנים: נתונים, סינון, מיון, הוספה, עריכה, העברה, מחיקה."""
import re
from playwright.sync_api import expect
from conftest import shot, api, goto_tab


def test_year_tabs_match_server_data(admin_page):
    p = admin_page
    for y in ["2025", "2026", "2027"]:
        goto_tab(p, y)
        doc = api(p, "GET", f"year/{y}")["data"]
        expect(p.locator("section.section")).to_have_count(len(doc["sections"]))
        expect(p.locator("tr.row")).to_have_count(len(doc["rows"]))
        expect(p.locator(".kpi").nth(1).locator(".val")).to_have_text(str(len(doc["rows"])))
    shot(p, "plan-2027")


def test_priority_and_column_filters(admin_page):
    p = admin_page
    goto_tab(p, "2027")
    rows = api(p, "GET", "year/2027")["data"]["rows"]
    p.select_option("#fp", "1")
    expect(p.locator("tr.row")).to_have_count(sum(1 for r in rows if r.get("priority") == "1"))
    expect(p.locator("#resultLine")).to_contain_text("מוצגות")
    p.click("#colToggle")
    p.fill("input[data-col=taskDetail]", "קבוצות")
    n = sum(1 for r in rows if r.get("priority") == "1" and "קבוצות" in (r.get("taskDetail") or ""))
    expect(p.locator("tr.row")).to_have_count(n)
    p.click("#fclear")
    expect(p.locator("tr.row")).to_have_count(len(rows))


def test_free_text_search_no_results_message(admin_page):
    p = admin_page
    p.fill("#fq", "zzz-no-such-text")
    expect(p.locator("#sections")).to_contain_text("לא נמצאו משימות")


def test_sort_by_priority_is_ascending_with_section_column(admin_page):
    p = admin_page
    goto_tab(p, "2027")
    p.select_option("#fsort", "priority")
    prios = [int(x) for x in p.locator("tr.row .prio").all_inner_texts()]
    assert prios == sorted(prios), prios
    expect(p.locator("table.plan th").first).to_have_text("סעיף")
    p.select_option("#fsort", "plan")


def test_add_edit_move_delete_task(admin_page):
    p = admin_page
    goto_tab(p, "2027")
    before = p.locator("tr.row").count()
    # add
    p.click("#addRow")
    p.fill("[name=task]", "משימת בדיקה אוטומטית")
    p.fill("[name=taskDetail]", "נוצרה ע״י הבדיקות")
    p.click("[data-save]")
    expect(p.locator("tr.row")).to_have_count(before + 1)
    row = p.locator("tr.row", has_text="נוצרה ע״י הבדיקות")
    expect(row).to_have_count(1)
    rid = row.get_attribute("data-id")
    # edit + move to section 3
    p.click(f"[data-editrow='{rid}']")
    target = p.locator("[name=sectionId] option").nth(2).get_attribute("value")
    p.select_option("[name=sectionId]", target)
    p.fill("[name=owner]", "בודק")
    p.click("[data-save]")
    moved = p.locator(f"section[data-sec='{target}'] tr.row[data-id='{rid}']")
    expect(moved).to_have_count(1)
    expect(moved).to_contain_text("בודק")
    # survives reload (server-side)
    p.reload()
    expect(p.locator(f"section[data-sec='{target}'] tr.row[data-id='{rid}']")).to_have_count(1)
    # delete needs two clicks
    btn = p.locator(f"[data-delrow='{rid}']")
    btn.click()
    expect(btn).to_have_text("ללחוץ שוב למחיקה")
    expect(p.locator(f"tr.row[data-id='{rid}']")).to_have_count(1)
    btn.click()
    expect(p.locator(f"tr.row[data-id='{rid}']")).to_have_count(0)
    expect(p.locator("tr.row")).to_have_count(before)


def test_quick_status_change_persists(admin_page):
    p = admin_page
    goto_tab(p, "2026")
    sel = p.locator("select.pill-select").first
    rid = sel.get_attribute("data-id")
    sel.select_option("בעבודה")
    expect(p.locator("#toast")).to_have_text("הסטטוס עודכן")
    p.reload()
    expect(p.locator(f"select.pill-select[data-id='{rid}']")).to_have_value("בעבודה")


def test_html_in_task_is_shown_as_text_not_executed(admin_page):
    p = admin_page
    goto_tab(p, "2027")
    payload = '<img src=x onerror="window.__xss=1"><b>bold</b>'
    p.click("#addRow")
    p.fill("[name=task]", payload)
    p.click("[data-save]")
    cell = p.locator("td.task-cell", has_text="<img src=x")
    expect(cell).to_have_count(1)
    assert p.evaluate("window.__xss") is None
    assert p.locator("td.task-cell b", has_text="bold").count() == 0


def test_section_edit_and_csv_export(admin_page):
    p = admin_page
    goto_tab(p, "2027")
    p.locator("[data-editsec]").first.click()
    p.fill(".modal [name=title]", "סעיף ששמו שונה בבדיקה")
    p.click(".modal button[type=submit]")
    expect(p.locator("section.section h2").first).to_have_text("סעיף ששמו שונה בבדיקה")
    with p.expect_download() as dl:
        p.click("#exportCsv")
    d = dl.value
    assert d.suggested_filename.endswith("2027.csv")
    text = open(d.path(), encoding="utf-8-sig").read()
    assert text.splitlines()[0].startswith('"סעיף","משימה"')


def test_add_year_copies_tasks_with_reset_status(admin_page):
    p = admin_page
    p.click("nav.tabs button[data-v='addyear']")
    p.fill(".modal [name=year]", "2028")
    p.click(".modal button[type=submit]")
    expect(p.locator("nav.tabs button[data-v='2028']")).to_have_class(re.compile("active"))
    p.wait_for_selector("select.pill-select")
    statuses = set(p.locator("select.pill-select").evaluate_all("els => els.map(e => e.value)"))
    assert statuses == {"לא החל"}, statuses
