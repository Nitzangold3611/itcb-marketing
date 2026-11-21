"""ניהול משתמשים, הזמנות, כניסה ראשונה, הרשאות בממשק."""
import re
import urllib.parse
from playwright.sync_api import expect
from conftest import shot, login, goto_tab


def _add_user(p, name, email, phone, role="editor"):
    goto_tab(p, "users")
    p.fill("#addUser [name=name]", name)
    p.fill("#addUser [name=username]", email)
    p.fill("#addUser [name=phone]", phone)
    p.select_option("#addUser [name=role]", role)
    pw = p.input_value("#addUser [name=password]")
    p.click("#addUser button[type=submit]")
    expect(p.locator(".invite-text")).to_be_visible()
    return pw


def test_add_user_invite_contains_password_in_mail_and_whatsapp(admin_page):
    p = admin_page
    pw = _add_user(p, "ירון כהן", "yaron@test.local", "052-123-4567")
    assert re.fullmatch(r"Itcb-[A-Za-z0-9]{10}", pw)
    text = p.input_value(".invite-text")
    assert pw in text and "yaron@test.local" in text
    mail = urllib.parse.unquote(p.get_attribute("[data-mail]", "href"))
    wa = p.get_attribute("[data-wa]", "href")
    assert mail.startswith("mailto:yaron@test.local?subject=") and pw in mail
    assert wa.startswith("https://wa.me/972521234567?text=") and pw in urllib.parse.unquote(wa)
    expect(p.locator("[data-wa-hint]")).to_contain_text("+972521234567")
    shot(p, "users-invite")
    p.fill("[name=waPhone]", "12")
    expect(p.locator("[data-wa-hint]")).to_have_text("מספר לא תקין")
    p.fill("[name=waPhone]", "+44 7700 900123")
    assert p.get_attribute("[data-wa]", "href").startswith("https://wa.me/447700900123?")


def test_first_login_forces_own_password(admin_page, browser, base_url, request):
    p = admin_page
    pw = _add_user(p, "דנה", "dana@test.local", "0501112222", "viewer")
    ctx = browser.new_context()
    q = ctx.new_page()
    request.addfinalizer(ctx.close)
    login(q, base_url, "dana@test.local", pw)
    expect(q.locator("#fpForm")).to_be_visible()
    shot(q, "users-first-login")
    q.fill("#fpNew", "LongPass111")
    q.fill("#fpAgain", "LongPass222")
    q.click("#fpForm button[type=submit]")
    expect(q.locator("#fpErr")).to_have_text("הסיסמאות אינן תואמות")
    # too short is blocked by the field itself (minlength=8) – nothing is sent
    q.fill("#fpNew", "abc"); q.fill("#fpAgain", "abc")
    q.click("#fpForm button[type=submit]")
    assert q.locator("#fpNew").evaluate("e => e.validity.tooShort") is True
    expect(q.locator("#fpForm")).to_be_visible()
    q.fill("#fpNew", "DanaOwnPass1")
    q.fill("#fpAgain", "DanaOwnPass1")
    q.click("#fpForm button[type=submit]")
    expect(q.locator(".section").first).to_be_visible()
    # viewer sees no edit controls
    expect(q.locator("#addRow")).to_have_count(0)
    expect(q.locator("[data-editrow]")).to_have_count(0)
    expect(q.locator("select.pill-select")).to_have_count(0)
    expect(q.locator("nav.tabs button[data-v='users']")).to_have_count(0)
    # admin list shows the user as having logged in
    p.click(".modal [data-close]")
    goto_tab(p, "dash"); goto_tab(p, "users")
    expect(p.locator("tr", has_text="dana@test.local")).not_to_contain_text("ממתין לבחירת סיסמה")


def test_role_change_and_delete_user(admin_page):
    p = admin_page
    _add_user(p, "זמני", "temp@test.local", "")
    p.click(".modal [data-close]")
    row = p.locator("tr", has_text="temp@test.local")
    row.locator("select").select_option("viewer")
    expect(p.locator("#toast")).to_have_text("ההרשאה עודכנה")
    btn = row.locator("[data-deluser]")
    btn.click(); btn.click()
    expect(p.locator("tr", has_text="temp@test.local")).to_have_count(0)


def test_cannot_delete_self_button_absent(admin_page):
    p = admin_page
    goto_tab(p, "users")
    me = p.locator("tr", has_text="admin@test.local")
    expect(me.locator("[data-deluser]")).to_have_count(0)
