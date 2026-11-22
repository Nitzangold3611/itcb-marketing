// API tests – run against the real function code with an in-memory store.
// node --test tests/api.test.mjs   (after: node tests/support/build.mjs)
import "./support/env.mjs";
import { TEST_ENV } from "./support/env.mjs";
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { __reset } from "./support/blobs-mock.mjs";

const { default: api } = await import("./.build/api.mjs");

async function call(method, path, body, token) {
  const r = await api(new Request("http://x/api/" + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }), {});
  return { status: r.status, data: await r.json() };
}
const login = async (u, p) => (await call("POST", "login", { username: u, password: p })).data.token;
const adminToken = () => login(TEST_ENV.ADMIN_EMAIL, TEST_ENV.ADMIN_PASSWORD);

async function makeUser(admin, email, role, pw = "TempPass123") {
  const r = await call("POST", "users", { name: email.split("@")[0], username: email, password: pw, role, phone: "052-123 4567" }, admin);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const t = await login(email, pw);
  const np = "OwnPass" + role + "9";
  await call("POST", "password", { current: pw, next: np }, t);
  return login(email, np);
}

beforeEach(() => __reset());

describe("אימות וכניסה", () => {
  test("כניסה עם סיסמה שגויה נדחית (401)", async () => {
    const r = await call("POST", "login", { username: TEST_ENV.ADMIN_EMAIL, password: "wrong" });
    assert.equal(r.status, 401);
    assert.ok(!r.data.token);
  });
  test("המייל לא תלוי באותיות גדולות/קטנות", async () => {
    const r = await call("POST", "login", { username: TEST_ENV.ADMIN_EMAIL.toUpperCase(), password: TEST_ENV.ADMIN_PASSWORD });
    assert.equal(r.status, 200);
    assert.equal(r.data.user.role, "admin");
  });
  test("משתמש שלא קיים מקבל אותה הודעה כמו סיסמה שגויה", async () => {
    const a = await call("POST", "login", { username: "nobody@x.io", password: "x" });
    const b = await call("POST", "login", { username: TEST_ENV.ADMIN_EMAIL, password: "x" });
    assert.equal(a.status, 401); assert.equal(a.data.error, b.data.error);
  });
  test("בלי טוקן אין גישה לנתונים", async () => {
    for (const p of ["years", "year/2027", "users", "me"]) assert.equal((await call("GET", p)).status, 401, p);
  });
  test("טוקן מזויף נדחה", async () => {
    const t = await adminToken();
    const [p] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ u: TEST_ENV.ADMIN_EMAIL, exp: Date.now() + 1e9, v: 1 })).toString("base64url");
    assert.equal((await call("GET", "years", null, `${forged}.${t.split(".")[1]}`)).status, 401);
    assert.equal((await call("GET", "years", null, `${p}.AAAA`)).status, 401);
  });
  test("טוקן שפג תוקפו נדחה", async () => {
    const p = Buffer.from(JSON.stringify({ u: TEST_ENV.ADMIN_EMAIL, exp: Date.now() - 1000, v: 1 })).toString("base64url");
    const s = createHmac("sha256", TEST_ENV.SESSION_SECRET).update(p).digest("base64url");
    assert.equal((await call("GET", "years", null, `${p}.${s}`)).status, 401);
  });
  test("טוקן של משתמש שנמחק מפסיק לעבוד", async () => {
    const admin = await adminToken();
    const t = await makeUser(admin, "gone@test.local", "editor");
    assert.equal((await call("GET", "years", null, t)).status, 200);
    await call("DELETE", "users/gone@test.local", null, admin);
    assert.equal((await call("GET", "years", null, t)).status, 401);
  });
});

describe("סיסמה זמנית ובחירת סיסמה", () => {
  test("משתמש חדש חסום עד שיבחר סיסמה", async () => {
    const admin = await adminToken();
    await call("POST", "users", { name: "N", username: "new@test.local", password: "TempPass123", role: "editor" }, admin);
    const t = await login("new@test.local", "TempPass123");
    const me = await call("GET", "me", null, t);
    assert.equal(me.data.user.mustChange, true);
    const r = await call("GET", "years", null, t);
    assert.equal(r.status, 403); assert.equal(r.data.code, "MUST_CHANGE");
  });
  test("אי אפשר לבחור את אותה סיסמה זמנית או סיסמה קצרה", async () => {
    const admin = await adminToken();
    await call("POST", "users", { name: "N", username: "n2@test.local", password: "TempPass123", role: "viewer" }, admin);
    const t = await login("n2@test.local", "TempPass123");
    assert.equal((await call("POST", "password", { current: "TempPass123", next: "TempPass123" }, t)).status, 400);
    assert.equal((await call("POST", "password", { current: "TempPass123", next: "short" }, t)).status, 400);
    assert.equal((await call("POST", "password", { current: "bad", next: "NewPass1234" }, t)).status, 403);
  });
  test("אחרי בחירת סיסמה: יש גישה, והסיסמה הזמנית לא עובדת", async () => {
    const admin = await adminToken();
    await call("POST", "users", { name: "N", username: "n3@test.local", password: "TempPass123", role: "viewer" }, admin);
    const t = await login("n3@test.local", "TempPass123");
    assert.equal((await call("POST", "password", { current: "TempPass123", next: "NewPass1234" }, t)).status, 200);
    assert.equal((await call("GET", "years", null, t)).status, 200);
    assert.equal((await call("POST", "login", { username: "n3@test.local", password: "TempPass123" })).status, 401);
  });
  test("איפוס סיסמה ע״י מנהל מחזיר את החובה לבחור סיסמה", async () => {
    const admin = await adminToken();
    await makeUser(admin, "r@test.local", "editor");
    await call("PUT", "users/r@test.local", { password: "ResetPass123" }, admin);
    const t = await login("r@test.local", "ResetPass123");
    assert.equal((await call("GET", "years", null, t)).data.code, "MUST_CHANGE");
  });
  test("מנהל שמאפס לעצמו לא נחסם", async () => {
    const admin = await adminToken();
    await call("PUT", `users/${TEST_ENV.ADMIN_EMAIL}`, { password: "AdminPass999" }, admin);
    const t = await login(TEST_ENV.ADMIN_EMAIL, "AdminPass999");
    assert.equal((await call("GET", "years", null, t)).status, 200);
  });
});

describe("הרשאות לפי תפקיד", () => {
  test("צופה: קורא בלבד", async () => {
    const admin = await adminToken();
    const v = await makeUser(admin, "v@test.local", "viewer");
    const doc = (await call("GET", "year/2027", null, v)).data;
    assert.equal((await call("PUT", `year/2027/row/${doc.rows[0].id}`, { status: "הסתיים" }, v)).status, 403);
    assert.equal((await call("POST", "year/2027/section", { title: "x" }, v)).status, 403);
    assert.equal((await call("DELETE", `year/2027/row/${doc.rows[0].id}`, null, v)).status, 403);
    assert.equal((await call("GET", "users", null, v)).status, 403);
    assert.equal((await call("POST", "years", { year: "2030" }, v)).status, 403);
  });
  test("עורך: עורך משימות, לא מנהל משתמשים ושנים", async () => {
    const admin = await adminToken();
    const e = await makeUser(admin, "e@test.local", "editor");
    const doc = (await call("GET", "year/2027", null, e)).data;
    assert.equal((await call("PUT", `year/2027/row/${doc.rows[0].id}`, { status: "בעבודה" }, e)).status, 200);
    assert.equal((await call("GET", "users", null, e)).status, 403);
    assert.equal((await call("POST", "years", { year: "2030" }, e)).status, 403);
  });
});

describe("ניהול משתמשים", () => {
  test("ולידציה: מייל לא תקין, כפול, סיסמה קצרה", async () => {
    const admin = await adminToken();
    assert.equal((await call("POST", "users", { username: "not-an-email", password: "LongEnough1" }, admin)).status, 400);
    assert.equal((await call("POST", "users", { username: TEST_ENV.ADMIN_EMAIL, password: "LongEnough1" }, admin)).status, 400);
    assert.equal((await call("POST", "users", { username: "ok@test.local", password: "short" }, admin)).status, 400);
  });
  test("תפקיד לא מוכר הופך לצופה; הטלפון נשמר בלי רווחים ומקפים", async () => {
    const admin = await adminToken();
    const r = await call("POST", "users", { name: "P", username: "p@test.local", password: "LongEnough1", role: "superuser", phone: "052-123 4567" }, admin);
    const u = r.data.users.find((x) => x.username === "p@test.local");
    assert.equal(u.role, "viewer"); assert.equal(u.phone, "0521234567");
  });
  test("רשימת המשתמשים לא חושפת hash או salt", async () => {
    const admin = await adminToken();
    const r = await call("GET", "users", null, admin);
    for (const u of r.data.users) { assert.ok(!("hash" in u)); assert.ok(!("salt" in u)); }
  });
  test("אי אפשר להוריד או למחוק את המנהל האחרון, ואי אפשר למחוק את עצמך", async () => {
    const admin = await adminToken();
    assert.equal((await call("PUT", `users/${TEST_ENV.ADMIN_EMAIL}`, { role: "viewer" }, admin)).status, 400);
    assert.equal((await call("DELETE", `users/${TEST_ENV.ADMIN_EMAIL}`, null, admin)).status, 400);
  });
  test("עדכון ומחיקה של משתמש שלא קיים מחזירים 404", async () => {
    const admin = await adminToken();
    assert.equal((await call("PUT", "users/none@test.local", { name: "x" }, admin)).status, 404);
    assert.equal((await call("DELETE", "users/none@test.local", null, admin)).status, 404);
  });
});

describe("נתוני התוכנית (seed)", () => {
  test("כל השנים נטענו במלואן", async () => {
    const t = await adminToken();
    assert.deepEqual((await call("GET", "years", null, t)).data.years, ["2025", "2026", "2027"]);
    const expect = { 2025: 27, 2026: 34, 2027: 40 };
    for (const [y, n] of Object.entries(expect)) {
      const d = (await call("GET", `year/${y}`, null, t)).data;
      assert.equal(d.rows.length, n, `rows ${y}`);
      assert.equal(d.sections.length, 7, `sections ${y}`);
      const ids = new Set(d.sections.map((s) => s.id));
      for (const r of d.rows) assert.ok(ids.has(r.sectionId), `row ${r.id} has a valid section`);
      assert.equal(new Set(d.rows.map((r) => r.id)).size, d.rows.length, "unique row ids");
    }
  });
  test("שנה שלא קיימת מחזירה 404; נתיב לא מוכר מחזיר 404", async () => {
    const t = await adminToken();
    assert.equal((await call("GET", "year/1999", null, t)).status, 404);
    assert.equal((await call("GET", "nope", null, t)).status, 404);
  });
});

describe("משימות", () => {
  test("יצירה דורשת סעיף קיים; משימה חדשה נכנסת אחרי משימות עם אותו שם", async () => {
    const t = await adminToken();
    const d = (await call("GET", "year/2027", null, t)).data;
    assert.equal((await call("POST", "year/2027/row", { task: "x" }, t)).status, 400);
    const ref = d.rows[0];
    const r = await call("POST", "year/2027/row", { sectionId: ref.sectionId, task: ref.task, taskDetail: "חדשה" }, t);
    const idx = r.data.rows.findIndex((x) => x.taskDetail === "חדשה");
    const lastSame = r.data.rows.map((x, i) => (x.task === ref.task && x.sectionId === ref.sectionId && x.taskDetail !== "חדשה" ? i : -1)).filter((i) => i >= 0).pop();
    assert.equal(idx, lastSame + 1);
    assert.ok(r.data.rows[idx].updatedBy && r.data.rows[idx].updatedAt);
  });
  test("העברה לסעיף אחר מעבירה את המשימה לסוף הסעיף החדש", async () => {
    const t = await adminToken();
    const d = (await call("GET", "year/2027", null, t)).data;
    const row = d.rows[0], target = d.sections[3].id;
    const r = await call("PUT", `year/2027/row/${row.id}`, { sectionId: target, task: "משימה שהועברה" }, t);
    const inTarget = r.data.rows.filter((x) => x.sectionId === target);
    assert.equal(inTarget[inTarget.length - 1].id, row.id);
    assert.equal(r.data.rows.length, d.rows.length);
  });
  test("מחיקה מסירה בדיוק משימה אחת", async () => {
    const t = await adminToken();
    const d = (await call("GET", "year/2027", null, t)).data;
    const r = await call("DELETE", `year/2027/row/${d.rows[5].id}`, null, t);
    assert.equal(r.data.rows.length, d.rows.length - 1);
    assert.ok(!r.data.rows.some((x) => x.id === d.rows[5].id));
  });
  test("תאריכי גאנט: פורמט לא תקין וסיום לפני התחלה נדחים", async () => {
    const t = await adminToken();
    const id = (await call("GET", "year/2027", null, t)).data.rows[0].id;
    assert.equal((await call("PUT", `year/2027/row/${id}`, { startDate: "10/02/2027" }, t)).status, 400);
    assert.equal((await call("PUT", `year/2027/row/${id}`, { startDate: "2027-05-01", endDate: "2027-04-01" }, t)).status, 400);
    const ok = await call("PUT", `year/2027/row/${id}`, { startDate: "2027-02-10", endDate: "2027-05-20" }, t);
    assert.equal(ok.status, 200);
    assert.equal(ok.data.rows.find((r) => r.id === id).endDate, "2027-05-20");
  });
  test("שדות לא מוכרים לא נשמרים; טקסט עם HTML נשמר כמו שהוא (הקליינט מבצע escape)", async () => {
    const t = await adminToken();
    const id = (await call("GET", "year/2027", null, t)).data.rows[0].id;
    const r = await call("PUT", `year/2027/row/${id}`, { notes: "<img src=x onerror=alert(1)>", isAdmin: true, id: "hijack" }, t);
    const row = r.data.rows.find((x) => x.id === id);
    assert.equal(row.notes, "<img src=x onerror=alert(1)>");
    assert.ok(!("isAdmin" in row));
  });
});

describe("סעיפים ושנים", () => {
  test("סעיף: יצירה, עריכה, ומחיקה רק כשהוא ריק", async () => {
    const t = await adminToken();
    assert.equal((await call("POST", "year/2027/section", { title: "  " }, t)).status, 400);
    let d = (await call("POST", "year/2027/section", { title: "סעיף בדיקה", detail: "פירוט" }, t)).data;
    const sec = d.sections.at(-1);
    d = (await call("PUT", `year/2027/section/${sec.id}`, { title: "שם חדש" }, t)).data;
    assert.equal(d.sections.at(-1).title, "שם חדש");
    const full = d.sections[0].id;
    assert.equal((await call("DELETE", `year/2027/section/${full}`, null, t)).status, 400);
    assert.equal((await call("DELETE", `year/2027/section/${sec.id}`, null, t)).status, 200);
  });
  test("הוספת שנה: ולידציה, העתקה מאפסת סטטוס והכנסות ומעדכנת שנה בתאריכים", async () => {
    const t = await adminToken();
    assert.equal((await call("POST", "years", { year: "abc" }, t)).status, 400);
    assert.equal((await call("POST", "years", { year: "2027" }, t)).status, 400);
    const r = await call("POST", "years", { year: "2028", copyFrom: "2027" }, t);
    assert.deepEqual(r.data.years, ["2025", "2026", "2027", "2028"]);
    const src = (await call("GET", "year/2027", null, t)).data;
    const d = (await call("GET", "year/2028", null, t)).data;
    assert.equal(d.rows.length, src.rows.length);
    assert.ok(d.rows.every((x) => x.status === "לא החל" && !x.income && !x.expense));
    assert.ok(!d.rows.some((x) => /2027/.test(x.date || "")));
    assert.equal(new Set(d.rows.map((x) => x.id)).size, d.rows.length);
    assert.ok(!d.rows.some((x) => src.rows.some((s) => s.id === x.id)), "new ids");
  });
  test("שנה ריקה נוצרת בלי משימות", async () => {
    const t = await adminToken();
    await call("POST", "years", { year: "2029", copyFrom: "" }, t);
    const d = (await call("GET", "year/2029", null, t)).data;
    assert.equal(d.rows.length, 0); assert.equal(d.sections.length, 0);
  });
});

describe("תקציב מספרי", () => {
  test("המרה חד-פעמית: סכום ברור הופך למספר, טקסט אחר עובר להערות בלי לאבד כלום", async () => {
    const t = await adminToken();
    const d = (await call("GET", "year/2027", null, t)).data;
    assert.equal(d.budgetNumeric, true);
    for (const r of d.rows) assert.ok(r.budget === "" || /^\d+(\.\d+)?$/.test(r.budget), `numeric or empty: ${r.budget}`);
    // "3800 ש״ח" and "13000" are clear amounts
    assert.ok(d.rows.some((r) => r.budget === "3800"));
    assert.ok(d.rows.some((r) => r.budget === "13000"));
    // texts with words/formulas are preserved word for word in notes
    for (const txt of ["אירוע: 12,000 ש״ח", "300 ש״ח * 150 בחינות", "800$ ל-1000 באדג׳ים", "12000צפי הכנסה"]) {
      assert.ok(d.rows.some((r) => (r.notes || "").includes(`תקציב (טקסט מקורי): ${txt}`)), txt);
    }
  });
  test("ההמרה רצה פעם אחת בלבד – קריאה נוספת לא משכפלת הערות", async () => {
    const t = await adminToken();
    const a = (await call("GET", "year/2026", null, t)).data;
    const b = (await call("GET", "year/2026", null, t)).data;
    assert.deepEqual(b.rows.map((r) => r.notes), a.rows.map((r) => r.notes));
  });
  test("שמירה: טקסט נדחה, סכום עם פסיקים או ₪ נשמר כמספר, ריק מנקה", async () => {
    const t = await adminToken();
    const id = (await call("GET", "year/2027", null, t)).data.rows[0].id;
    let r = await call("PUT", `year/2027/row/${id}`, { budget: "בערך אלף" }, t);
    assert.equal(r.status, 400); assert.match(r.data.error, /מספר/);
    assert.equal((await call("PUT", `year/2027/row/${id}`, { budget: "-50" }, t)).status, 400);
    r = await call("PUT", `year/2027/row/${id}`, { budget: "₪ 12,500" }, t);
    assert.equal(r.data.rows.find((x) => x.id === id).budget, "12500");
    r = await call("PUT", `year/2027/row/${id}`, { budget: "" }, t);
    assert.equal(r.data.rows.find((x) => x.id === id).budget, "");
  });
  test("שנה חדשה (ריקה או מועתקת) כבר מסומנת כמספרית", async () => {
    const t = await adminToken();
    await call("POST", "years", { year: "2028", copyFrom: "2027" }, t);
    const d = (await call("GET", "year/2028", null, t)).data;
    assert.equal(d.budgetNumeric, true);
    assert.ok(d.rows.every((r) => r.budget === "" || /^\d+(\.\d+)?$/.test(r.budget)));
  });
});
