"""תצוגת מובייל: תפריט צד, בלי גלילה לרוחב."""
import pytest
from playwright.sync_api import expect
from conftest import shot

VIEWS = ["2025", "2026", "2027", "dash", "gantt", "compare", "users"]


def test_burger_menu_replaces_tabs(admin_mobile):
    p = admin_mobile
    expect(p.locator("nav.tabs")).to_be_hidden()
    expect(p.locator("#burger")).to_be_visible()
    p.click("#burger")
    expect(p.locator("#sideNav")).to_have_class("side-nav open")
    shot(p, "mobile-menu")
    p.click("#sideOv", position={"x": 20, "y": 400})
    expect(p.locator("#sideNav")).not_to_have_class("side-nav open")


@pytest.mark.parametrize("view", VIEWS)
def test_no_horizontal_page_scroll(admin_mobile, view):
    p = admin_mobile
    p.click("#burger")
    p.click(f"#sideNav button[data-v='{view}']")
    expect(p.locator("#sideNav")).not_to_have_class("side-nav open")
    p.wait_for_timeout(400)
    sw, cw = p.evaluate("[document.documentElement.scrollWidth, document.documentElement.clientWidth]")
    assert sw <= cw, f"page scrolls sideways on {view}: {sw} > {cw}"
    if view in ("2027", "dash"):
        shot(p, f"mobile-{view}")


@pytest.mark.parametrize("size", [(390, 844), (360, 740), (844, 390)], ids=["portrait-390", "portrait-360", "landscape"])
def test_presentation_controls_fit_and_close_works(admin_mobile, size):
    p = admin_mobile
    p.set_viewport_size({"width": size[0], "height": size[1]})
    p.goto(p.url)
    p.wait_for_selector(".section")
    if p.locator("#burger").is_visible():
        p.click("#burger")
        p.click("#sideNav button[data-v='dash']")
    else:
        p.click("nav.tabs button[data-v='dash']")
    p.click("#presentBtn")
    expect(p.locator(".slide")).to_be_visible()
    for sel in ["[data-p=close]", "[data-p=next]", "[data-p=prev]", ".pr-year", ".pr-count"]:
        box = p.locator(sel).bounding_box()
        assert box and box["x"] >= 0 and box["x"] + box["width"] <= size[0] + 1, f"{sel} outside the screen: {box}"
    assert p.evaluate("document.querySelector('.pr-bar').scrollWidth") <= size[0] + 1
    if size == (390, 844):
        shot(p, "mobile-presentation")
    p.click("[data-p=next]")
    expect(p.locator(".pr-count")).to_contain_text("2 /")
    p.click("[data-p=close]")
    expect(p.locator(".present")).to_have_count(0)
