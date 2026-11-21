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
