"""Shared fixtures for the browser (E2E) tests.

Each test module gets its own fresh server (fresh in-memory data), so modules
never depend on each other's changes. Any JavaScript error on the page fails
the test that caused it.
"""
import os
import socket
import subprocess
import time
from pathlib import Path

import pytest
from playwright.sync_api import sync_playwright, Page, expect

ROOT = Path(__file__).resolve().parents[2]
ARTIFACTS = ROOT / "tests" / ".artifacts"
SHOTS = ARTIFACTS / "screens"
ADMIN = ("admin@test.local", "AdminPass123")

expect.set_options(timeout=5000)


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def base_url():
    port = _free_port()
    proc = subprocess.Popen(
        ["node", str(ROOT / "tests/support/server.mjs"), str(port)],
        cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
    )
    url = f"http://127.0.0.1:{port}"
    for _ in range(100):
        try:
            socket.create_connection(("127.0.0.1", port), timeout=0.2).close()
            break
        except OSError:
            time.sleep(0.1)
    else:
        proc.kill()
        raise RuntimeError("test server did not start")
    yield url
    proc.terminate()
    proc.wait(timeout=5)


@pytest.fixture(scope="session")
def browser():
    with sync_playwright() as p:
        b = p.chromium.launch()
        yield b
        b.close()


def _new_page(browser, request, **ctx_kwargs) -> Page:
    ctx = browser.new_context(locale="he-IL", **ctx_kwargs)
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("dialog", lambda d: (errors.append(f"unexpected dialog: {d.message}"), d.dismiss()))
    request.node._page_errors = errors
    request.addfinalizer(ctx.close)
    return page


@pytest.fixture
def page(browser, request):
    p = _new_page(browser, request, viewport={"width": 1440, "height": 900})
    yield p
    assert not request.node._page_errors, f"JavaScript errors on page: {request.node._page_errors}"


@pytest.fixture
def mobile_page(browser, request):
    p = _new_page(browser, request, viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, device_scale_factor=2)
    yield p
    assert not request.node._page_errors, f"JavaScript errors on page: {request.node._page_errors}"


def login(page: Page, base_url: str, email=ADMIN[0], password=ADMIN[1]):
    page.goto(base_url + "/")
    page.fill("#u", email)
    page.fill("#p", password)
    page.click("#loginForm button[type=submit]")


@pytest.fixture
def admin_page(page, base_url):
    login(page, base_url)
    page.wait_for_selector(".section, .hb, .gantt, #addUser")
    return page


@pytest.fixture
def admin_mobile(mobile_page, base_url):
    login(mobile_page, base_url)
    mobile_page.wait_for_selector(".section")
    return mobile_page


def shot(page: Page, name: str, full_page=False):
    SHOTS.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(SHOTS / f"{name}.png"), full_page=full_page)


def api(page: Page, method: str, path: str, body=None):
    """Call the API from inside the page with the logged-in user's token."""
    return page.evaluate(
        """async ([m, p, b]) => {
            const t = localStorage.getItem('itcb_token');
            const r = await fetch('/api/' + p, {method: m, headers: {'content-type': 'application/json', authorization: 'Bearer ' + t},
                                                 body: b ? JSON.stringify(b) : undefined});
            return {status: r.status, data: await r.json()};
        }""",
        [method, path, body],
    )


def goto_tab(page: Page, view: str):
    """Switch tab and wait until its content finished loading."""
    page.click(f"nav.tabs button[data-v='{view}']")
    page.wait_for_selector(f"nav.tabs button[data-v='{view}'].active")
    page.wait_for_function("() => !document.querySelector('#main .loading') && document.querySelector('#main').children.length > 0")
