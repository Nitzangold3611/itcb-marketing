import type { Config, Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { scryptSync, randomBytes, timingSafeEqual, createHmac, randomUUID } from "node:crypto";
import seed from "./lib/seed.mjs";

const store = () => getStore({ name: "itcb-marketing", consistency: "strong" });

type Role = "admin" | "editor" | "viewer";
interface User { username: string; name: string; phone?: string; mustChange?: boolean; role: Role; salt: string; hash: string; createdAt: string; lastLogin?: string }
interface Section { id: string; title: string; detail: string }
interface Row { id: string; sectionId: string; [k: string]: string }
interface YearDoc { sections: Section[]; rows: Row[]; updatedAt?: string; updatedBy?: string }

const ROW_FIELDS = ["task", "taskDetail", "updates", "status", "budget", "owner", "date", "priority", "income", "expense", "notes", "sectionId", "startDate", "endDate"];
const SESSION_HOURS = 24 * 14;

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "cache-control": "no-store" } });
const err = (message: string, status = 400) => json({ error: message }, status);

// ---------- crypto helpers ----------
const hashPw = (pw: string, salt = randomBytes(16).toString("hex")) => ({ salt, hash: scryptSync(pw, salt, 64).toString("hex") });
const checkPw = (pw: string, u: User) => {
  const h = scryptSync(pw, u.salt, 64);
  const ref = Buffer.from(u.hash, "hex");
  return h.length === ref.length && timingSafeEqual(h, ref);
};
const secret = () => {
  const s = Netlify.env.get("SESSION_SECRET");
  if (!s) throw new Error("SESSION_SECRET is not configured");
  return s;
};
const b64 = (s: string) => Buffer.from(s).toString("base64url");
const sign = (payload: object) => {
  const p = b64(JSON.stringify(payload));
  return `${p}.${createHmac("sha256", secret()).update(p).digest("base64url")}`;
};
const verify = (token: string): { u: string; exp: number; v: number } | null => {
  const [p, s] = token.split(".");
  if (!p || !s) return null;
  const expect = createHmac("sha256", secret()).update(p).digest("base64url");
  if (expect.length !== s.length || !timingSafeEqual(Buffer.from(expect), Buffer.from(s))) return null;
  try {
    const data = JSON.parse(Buffer.from(p, "base64url").toString());
    return data.exp > Date.now() ? data : null;
  } catch { return null; }
};

// ---------- storage ----------
async function getUsers(): Promise<User[]> {
  const s = store();
  let users = (await s.get("users", { type: "json" })) as User[] | null;
  if (!users || users.length === 0) {
    const pw = Netlify.env.get("ADMIN_PASSWORD");
    if (!pw) throw new Error("ADMIN_PASSWORD is not configured");
    const username = (Netlify.env.get("ADMIN_EMAIL") || "admin@itcb.org.il").trim().toLowerCase();
    users = [{ username, name: Netlify.env.get("ADMIN_NAME") || "מנהל מערכת", role: "admin", ...hashPw(pw), createdAt: new Date().toISOString() }];
    await s.setJSON("users", users);
  }
  return users;
}
const saveUsers = (users: User[]) => store().setJSON("users", users);
const publicUser = (u: User) => ({ username: u.username, name: u.name, phone: u.phone || "", mustChange: !!u.mustChange, role: u.role, createdAt: u.createdAt, lastLogin: u.lastLogin });

async function getYears(): Promise<string[]> {
  const s = store();
  let years = (await s.get("years", { type: "json" })) as string[] | null;
  if (!years) {
    years = Object.keys(seed).sort();
    for (const y of years) {
      if (!(await s.get(`year-${y}`))) await s.setJSON(`year-${y}`, seed[y as keyof typeof seed]);
    }
    await s.setJSON("years", years);
  }
  return years;
}
async function getYear(y: string): Promise<YearDoc | null> {
  const years = await getYears();
  if (!years.includes(y)) return null;
  return (await store().get(`year-${y}`, { type: "json" })) as YearDoc | null;
}
const saveYear = (y: string, doc: YearDoc, by: string) => {
  doc.updatedAt = new Date().toISOString();
  doc.updatedBy = by;
  return store().setJSON(`year-${y}`, doc);
};

// ---------- auth ----------
async function auth(req: Request): Promise<User | null> {
  const h = req.headers.get("authorization") || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!token) return null;
  const data = verify(token);
  if (!data) return null;
  const users = await getUsers();
  return users.find((u) => u.username === data.u) || null;
}
const canEdit = (u: User) => u.role === "admin" || u.role === "editor";

const clean = (s: unknown, max = 20000) => (typeof s === "string" ? s.slice(0, max) : "");

export default async (req: Request, context: Context) => {
  try {
    const url = new URL(req.url);
    const parts = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
    const method = req.method;
    const body = method === "GET" || method === "DELETE" ? {} : await req.json().catch(() => ({}));

    // ---- public: login ----
    if (parts[0] === "login" && method === "POST") {
      const users = await getUsers();
      const username = clean(body.username, 100).trim().toLowerCase();
      const u = users.find((x) => x.username === username);
      if (!u || !checkPw(clean(body.password, 200), u)) return err("מייל או סיסמה שגויים", 401);
      u.lastLogin = new Date().toISOString();
      await saveUsers(users);
      const token = sign({ u: u.username, exp: Date.now() + SESSION_HOURS * 3600e3, v: 1 });
      return json({ token, user: publicUser(u) });
    }

    const me = await auth(req);
    if (!me) return err("נדרשת התחברות", 401);

    if (parts[0] === "me") return json({ user: publicUser(me) });
    if (me.mustChange && parts[0] !== "password") return json({ error: "יש לבחור סיסמה חדשה לפני הכניסה", code: "MUST_CHANGE" }, 403);

    if (parts[0] === "password" && method === "POST") {
      const users = await getUsers();
      const u = users.find((x) => x.username === me.username)!;
      if (!checkPw(clean(body.current, 200), u)) return err("הסיסמה הנוכחית שגויה", 403);
      const np = clean(body.next, 200);
      if (np.length < 8) return err("הסיסמה החדשה חייבת להכיל לפחות 8 תווים");
      if (checkPw(np, u)) return err("הסיסמה החדשה חייבת להיות שונה מהנוכחית");
      Object.assign(u, hashPw(np));
      u.mustChange = false;
      await saveUsers(users);
      return json({ ok: true });
    }

    // ---- users (admin) ----
    if (parts[0] === "users") {
      if (me.role !== "admin") return err("אין הרשאה", 403);
      const users = await getUsers();
      const target = parts[1]?.toLowerCase();
      if (method === "GET") return json({ users: users.map(publicUser) });
      if (method === "POST" && !target) {
        const username = clean(body.username, 60).trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(username)) return err("כתובת מייל לא תקינה");
        if (users.some((u) => u.username === username)) return err("כבר קיים משתמש עם המייל הזה");
        const pw = clean(body.password, 200);
        if (pw.length < 8) return err("הסיסמה חייבת להכיל לפחות 8 תווים");
        const role = (["admin", "editor", "viewer"].includes(body.role) ? body.role : "viewer") as Role;
        users.push({ username, name: clean(body.name, 100) || username, phone: clean(body.phone, 30).replace(/[^\d+]/g, ""), role, mustChange: true, ...hashPw(pw), createdAt: new Date().toISOString() });
        await saveUsers(users);
        return json({ users: users.map(publicUser) });
      }
      const u = users.find((x) => x.username === target);
      if (!u) return err("משתמש לא נמצא", 404);
      if (method === "PUT") {
        if (body.name !== undefined) u.name = clean(body.name, 100) || u.username;
        if (body.phone !== undefined) u.phone = clean(body.phone, 30).replace(/[^\d+]/g, "");
        if (body.role && ["admin", "editor", "viewer"].includes(body.role)) {
          if (u.role === "admin" && body.role !== "admin" && users.filter((x) => x.role === "admin").length === 1) return err("חייב להישאר לפחות מנהל אחד");
          u.role = body.role;
        }
        if (body.password) {
          if (String(body.password).length < 8) return err("הסיסמה חייבת להכיל לפחות 8 תווים");
          Object.assign(u, hashPw(clean(body.password, 200)));
          u.mustChange = u.username !== me.username;
        }
        await saveUsers(users);
        return json({ users: users.map(publicUser) });
      }
      if (method === "DELETE") {
        if (u.username === me.username) return err("אי אפשר למחוק את המשתמש שלך");
        if (u.role === "admin" && users.filter((x) => x.role === "admin").length === 1) return err("חייב להישאר לפחות מנהל אחד");
        const rest = users.filter((x) => x !== u);
        await saveUsers(rest);
        return json({ users: rest.map(publicUser) });
      }
    }

    // ---- years ----
    if (parts[0] === "years") {
      if (method === "GET") return json({ years: await getYears() });
      if (method === "POST") {
        if (me.role !== "admin") return err("אין הרשאה", 403);
        const y = clean(body.year, 4);
        if (!/^20\d\d$/.test(y)) return err("שנה לא תקינה");
        const years = await getYears();
        if (years.includes(y)) return err("השנה כבר קיימת");
        let doc: YearDoc = { sections: [], rows: [] };
        if (body.copyFrom && years.includes(body.copyFrom)) {
          const src = (await getYear(body.copyFrom))!;
          doc = {
            sections: src.sections.map((s) => ({ ...s })),
            rows: src.rows.map((r) => ({
              ...r, id: randomUUID(), status: "לא החל", income: "", expense: "",
              updates: body.keepUpdates ? r.updates : "",
              date: (r.date || "").replaceAll(String(body.copyFrom), y),
              updatedAt: "", updatedBy: "",
            })),
          };
        }
        await saveYear(y, doc, me.username);
        const next = [...years, y].sort();
        await store().setJSON("years", next);
        return json({ years: next });
      }
    }

    if (parts[0] === "year" && parts[1]) {
      const y = parts[1];
      const doc = await getYear(y);
      if (!doc) return err("שנה לא נמצאה", 404);
      if (method === "GET" && parts.length === 2) return json(doc);
      if (!canEdit(me)) return err("אין לך הרשאת עריכה", 403);

      if (parts[2] === "row") {
        if (method === "DELETE" && parts[3]) {
          doc.rows = doc.rows.filter((r) => r.id !== parts[3]);
          await saveYear(y, doc, me.username);
          return json(doc);
        }
        if (method === "PUT" || method === "POST") {
          const id = parts[3] || randomUUID();
          let row = doc.rows.find((r) => r.id === id);
          const isNew = !row;
          if (!row) row = { id, sectionId: "" } as Row;
          const prevSection = row.sectionId;
          const prevTask = row.task;
          for (const f of ROW_FIELDS) if (body[f] !== undefined) row[f] = clean(body[f]);
          if (!doc.sections.some((s) => s.id === row!.sectionId)) return err("יש לבחור סעיף");
          for (const f of ["startDate", "endDate"]) if (row[f] && !/^\d{4}-\d{2}-\d{2}$/.test(row[f])) return err("תאריך לא תקין");
          if (row.startDate && row.endDate && row.endDate < row.startDate) return err("תאריך הסיום לפני תאריך ההתחלה");
          row.updatedAt = new Date().toISOString();
          row.updatedBy = me.name || me.username;
          const moved = !isNew && (prevSection !== row.sectionId || prevTask !== row.task);
          if (moved) doc.rows = doc.rows.filter((r) => r !== row);
          if (isNew || moved) {
            // insert after the last row of the same section (and same task if given)
            let idx = -1;
            doc.rows.forEach((r, i) => { if (r.sectionId === row!.sectionId && (!row!.task || r.task === row!.task)) idx = i; });
            if (idx < 0) doc.rows.forEach((r, i) => { if (r.sectionId === row!.sectionId) idx = i; });
            if (idx < 0) {
              const secIdx = doc.sections.findIndex((s) => s.id === row!.sectionId);
              doc.rows.forEach((r, i) => { if (doc.sections.findIndex((s) => s.id === r.sectionId) < secIdx) idx = i; });
            }
            doc.rows.splice(idx + 1, 0, row);
          }
          await saveYear(y, doc, me.username);
          return json(doc);
        }
      }
      if (parts[2] === "section") {
        if (method === "POST") {
          const title = clean(body.title, 500).trim();
          if (!title) return err("יש להזין שם סעיף");
          doc.sections.push({ id: randomUUID(), title, detail: clean(body.detail) });
          await saveYear(y, doc, me.username);
          return json(doc);
        }
        const sec = doc.sections.find((s) => s.id === parts[3]);
        if (!sec) return err("סעיף לא נמצא", 404);
        if (method === "PUT") {
          if (body.title !== undefined) sec.title = clean(body.title, 500).trim() || sec.title;
          if (body.detail !== undefined) sec.detail = clean(body.detail);
          await saveYear(y, doc, me.username);
          return json(doc);
        }
        if (method === "DELETE") {
          if (doc.rows.some((r) => r.sectionId === sec.id)) return err("אי אפשר למחוק סעיף שיש בו משימות");
          doc.sections = doc.sections.filter((s) => s !== sec);
          await saveYear(y, doc, me.username);
          return json(doc);
        }
      }
    }
    return err("לא נמצא", 404);
  } catch (e) {
    console.error(e);
    return err("שגיאת שרת: " + (e instanceof Error ? e.message : String(e)), 500);
  }
};

export const config: Config = { path: "/api/*" };
