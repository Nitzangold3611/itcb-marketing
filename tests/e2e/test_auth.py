"""כניסה, יציאה, הצגת סיסמה."""
from playwright.sync_api import expect
from conftest import login, shot, ADMIN


def test_wrong_password_shows_error(page, base_url):
    login(page, base_url, ADMIN[0], "wrong-password")
    expect(page.locator("#loginErr")).to_have_text("מייל או סיסמה שגויים")
    expect(page.locator(".section")).to_have_count(0)


def test_password_eye_toggles_visibility(page, base_url):
    page.goto(base_url + "/")
    page.fill("#p", "Secret123")
    eye = page.locator(".pw-eye")
    expect(eye).to_have_attribute("aria-label", "הצגת הסיסמה")
    eye.click()
    expect(page.locator("#p")).to_have_attribute("type", "text")
    expect(eye).to_have_attribute("aria-label", "הסתרת הסיסמה")
    eye.click()
    expect(page.locator("#p")).to_have_attribute("type", "password")
    shot(page, "auth-login")


def test_login_logout_and_session_persists(page, base_url):
    login(page, base_url)
    expect(page.locator(".section").first).to_be_visible()
    page.reload()
    expect(page.locator(".section").first).to_be_visible()  # token kept
    page.click("#userBtn")
    page.click("[data-act=logout]")
    expect(page.locator("#loginForm")).to_be_visible()
    page.reload()
    expect(page.locator("#loginForm")).to_be_visible()


def test_footer_shows_version(admin_page):
    expect(admin_page.locator("footer.ver")).to_contain_text("גרסה")
