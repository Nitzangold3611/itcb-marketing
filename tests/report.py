"""Builds the QA report from the JUnit XML results.

Outputs (in tests/reports/):
  latest.html         – full report with screenshots (not committed)
  <version>.md        – short Markdown report, committed with the release
Prints the Markdown summary to stdout.
"""
import base64
import datetime as dt
import html
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
T = ROOT / "tests"
RES = T / ".artifacts"
OUT = T / "reports"
SHOTS = RES / "screens"

SUITE_NAMES = {
    "api": "בדיקות שרת (API)",
    "test_auth": "כניסה ואבטחת כניסה",
    "test_plan": "תוכנית שנתית: נתונים, סינון, עריכה",
    "test_views": "דשבורד, מצב הצגה, השוואה, גאנט",
    "test_users": "ניהול משתמשים והזמנות",
    "test_mobile": "תצוגת מובייל",
}


def version() -> str:
    m = re.search(r'const VERSION = "([\d.]+)"', (ROOT / "public/app.js").read_text(encoding="utf-8"))
    return m.group(1) if m else "?"


def parse(path: Path, kind: str):
    """-> list of dicts: suite, name, status (pass/fail/skip), time, message"""
    if not path.exists():
        return [{"suite": kind, "name": f"{path.name} חסר – ההרצה לא הסתיימה", "status": "fail", "time": 0, "message": ""}]
    root = ET.parse(path).getroot()
    parent = {c: p for p in root.iter() for c in p}
    out = []
    for tc in root.iter("testcase"):
        if kind == "api":
            suite = "api"
            name = tc.get("name", "")
            # node's junit reporter nests describe() blocks as <testsuite name="...">
            ps = parent.get(tc)
            group = ps.get("name") if ps is not None and ps.tag == "testsuite" else ""
            if group and group != name:
                name = f"{group} › {name}"
        else:
            cls = tc.get("classname", "")
            suite = cls.split(".")[-1] if cls else "e2e"
            name = tc.get("name", "")
        fail = tc.find("failure")
        if fail is None:
            fail = tc.find("error")
        skip = tc.find("skipped")
        status = "fail" if fail is not None else "skip" if skip is not None else "pass"
        msg = ""
        if fail is not None:
            msg = (fail.get("message") or "") + "\n" + (fail.text or "")
        out.append({"suite": suite, "name": name, "status": status, "time": float(tc.get("time") or 0), "message": msg.strip()[:3000]})
    # node junit also emits a testcase per describe block (no assertions) – drop those duplicates
    if kind == "api":
        names = {c["name"] for c in out}
        out = [c for c in out if not any(n.startswith(c["name"] + " › ") for n in names)]
    return out


def main():
    cases = parse(RES / "api.xml", "api") + parse(RES / "e2e.xml", "e2e")
    v = version()
    now = dt.datetime.now(dt.timezone(dt.timedelta(hours=2))).strftime("%d.%m.%Y %H:%M")
    total = len(cases)
    passed = sum(c["status"] == "pass" for c in cases)
    failed = [c for c in cases if c["status"] == "fail"]
    skipped = sum(c["status"] == "skip" for c in cases)
    dur = sum(c["time"] for c in cases)
    verdict = "✅ תקין – אפשר להעלות" if not failed else "❌ נמצאו כשלים – לא להעלות"

    suites = {}
    for c in cases:
        suites.setdefault(c["suite"], []).append(c)

    # ---------- markdown ----------
    md = [f"# דוח בדיקות · גרסה {v}", "", f"**תאריך:** {now}  ", f"**תוצאה:** {verdict}", "",
          f"| סה״כ | עברו | נכשלו | דולגו | זמן |", "|---|---|---|---|---|",
          f"| {total} | {passed} | {len(failed)} | {skipped} | {dur:.0f} שנ׳ |", "",
          "## לפי תחום", "", "| תחום | עברו | נכשלו |", "|---|---|---|"]
    for s, cs in suites.items():
        md.append(f"| {SUITE_NAMES.get(s, s)} | {sum(c['status']=='pass' for c in cs)} | {sum(c['status']=='fail' for c in cs)} |")
    if failed:
        md += ["", "## כשלים", ""]
        for c in failed:
            first = (c["message"].splitlines() or [""])[0]
            md.append(f"- **{SUITE_NAMES.get(c['suite'], c['suite'])} · {c['name']}**: {first}")
    md += ["", "## כל הבדיקות", ""]
    for s, cs in suites.items():
        md.append(f"### {SUITE_NAMES.get(s, s)}")
        for c in cs:
            icon = {"pass": "✅", "fail": "❌", "skip": "⏭️"}[c["status"]]
            md.append(f"- {icon} {c['name']}")
        md.append("")
    md_text = "\n".join(md)

    # ---------- html ----------
    def row(c):
        icon = {"pass": "✅", "fail": "❌", "skip": "⏭️"}[c["status"]]
        err = f"<pre>{html.escape(c['message'])}</pre>" if c["status"] == "fail" else ""
        return f"<tr class='{c['status']}'><td>{icon}</td><td>{html.escape(c['name'])}{err}</td><td>{c['time']:.2f}</td></tr>"

    shots = ""
    if SHOTS.exists():
        for f in sorted(SHOTS.glob("*.png")):
            b64 = base64.b64encode(f.read_bytes()).decode()
            shots += f"<figure><img src='data:image/png;base64,{b64}' alt='{f.stem}'><figcaption>{f.stem}</figcaption></figure>"
    sections = "".join(
        f"<h2>{html.escape(SUITE_NAMES.get(s, s))} <small>{sum(c['status']=='pass' for c in cs)}/{len(cs)}</small></h2>"
        f"<table><thead><tr><th></th><th>בדיקה</th><th>שנ׳</th></tr></thead><tbody>{''.join(row(c) for c in cs)}</tbody></table>"
        for s, cs in suites.items())
    page = f"""<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>דוח בדיקות {v}</title>
<style>body{{font-family:Assistant,Arial,sans-serif;background:#F4F5FA;color:#151936;margin:0;padding:24px}}
.wrap{{max-width:1100px;margin:auto}}h1{{color:#0B14A3;margin:0 0 4px}}.meta{{color:#666;margin-bottom:16px}}
.verdict{{font-size:20px;font-weight:800;padding:14px 18px;border-radius:12px;background:{'#E2F5EC' if not failed else '#FDECEC'};margin-bottom:16px}}
.kpis{{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:20px}}.kpi{{background:#fff;border-radius:12px;padding:12px 14px}}
.kpi b{{display:block;font-size:26px}}table{{width:100%;border-collapse:collapse;background:#fff;border-radius:12px;overflow:hidden;margin-bottom:18px}}
th,td{{text-align:right;padding:8px 10px;border-bottom:1px solid #eee;vertical-align:top;font-size:14px}}th{{background:#F8F9FD}}
tr.fail td{{background:#FFF5F5}}pre{{white-space:pre-wrap;background:#2b2b2b;color:#f5f5f5;padding:10px;border-radius:8px;font-size:12px;direction:ltr;text-align:left}}
h2 small{{color:#888;font-weight:500}}.shots{{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:12px}}
figure{{margin:0;background:#fff;border-radius:12px;padding:8px}}figure img{{width:100%;border-radius:8px}}figcaption{{font-size:13px;color:#555;padding-top:4px}}</style></head>
<body><div class="wrap"><h1>דוח בדיקות · ITCB · גרסה {v}</h1><div class="meta">{now}</div>
<div class="verdict">{verdict}</div>
<div class="kpis"><div class="kpi">סה״כ<b>{total}</b></div><div class="kpi">עברו<b>{passed}</b></div><div class="kpi">נכשלו<b>{len(failed)}</b></div><div class="kpi">דולגו<b>{skipped}</b></div><div class="kpi">זמן<b>{dur:.0f} שנ׳</b></div></div>
{sections}<h2>צילומי מסך</h2><div class="shots">{shots}</div></div></body></html>"""
    OUT.mkdir(exist_ok=True)
    (OUT / "latest.html").write_text(page, encoding="utf-8")
    (OUT / f"v{v}.md").write_text(md_text + "\n", encoding="utf-8")
    print(md_text)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
