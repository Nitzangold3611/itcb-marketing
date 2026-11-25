/* ITCB marketing plan – client */
(() => {
  const VERSION = "1.9.4";
  const STATUSES = ["לא החל", "בעבודה", "הסתיים", "הועבר לשנה אחרי", "בוטל"];
  const ROLE_LABEL = { admin: "מנהל", editor: "עורך", viewer: "צופה" };
  const COLS = [
    ["task", "משימה"], ["taskDetail", "פירוט המשימה"], ["updates", "עדכונים שוטפים"], ["status", "סטטוס"],
    ["budget", "תקציב"], ["owner", "אחראי"], ["date", "תאריך מתוכנן"], ["priority", "קדימות"],
    ["income", "הכנסה בפועל"], ["expense", "הוצאה בפועל"], ["notes", "הערות"],
  ];

  const $app = document.getElementById("app");
  // localStorage wrapper (can throw in some contexts)
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
    del: (k) => { try { localStorage.removeItem(k); } catch {} },
  };
  const S = {
    token: store.get("itcb_token"), user: null, years: [], view: null, docs: {},
    filters: { q: "", cols: {}, section: "" }, treeOpen: new Set(), treeAll: false, sort: "plan", showColFilters: false, collapsed: new Set(), users: [],
  };

  // ---------- utils ----------
  function esc(s) { return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
  function stClass(s) {
    if (s === "הסתיים") return "st-done";
    if (s === "בעבודה") return "st-work";
    if (s === "לא החל") return "st-todo";
    if (s === "הועבר לשנה אחרי") return "st-moved";
    return "st-other";
  }
  const stColor = { "הסתיים": "var(--done)", "בעבודה": "#E08A00", "לא החל": "#8A94C6", "הועבר לשנה אחרי": "var(--moved)", "בוטל": "#555" };
  function toast(msg, bad) {
    const t = document.getElementById("toast");
    t.textContent = msg; t.className = "show" + (bad ? " bad" : "");
    clearTimeout(toast._t); toast._t = setTimeout(() => (t.className = ""), 2600);
  }
  function fmtDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    return d.toLocaleDateString("he-IL") + " " + d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
  }
  function num(s) {
    const t = String(s || "").replace(/[,\s₪]/g, "").replace(/ש״ח|ש"ח/g, "");
    return /^-?\d+(\.\d+)?$/.test(t) ? parseFloat(t) : null;
  }
  const shekel = (n) => `<bdi dir="ltr">${n < 0 ? "−" : ""}₪${Math.abs(Math.round(n)).toLocaleString("he-IL")}</bdi>`;
  const money = (v) => { const n = num(v); return n === null ? esc(v) : shekel(n); };
  const MONEY = [["budget", "תקציב מתוכנן", "#5160D8"], ["expense", "הוצאה בפועל", "#F06A2C"], ["income", "הכנסה בפועל", "#0F9488"]];
  function moneyTotals(rows) {
    const t = { budget: 0, expense: 0, income: 0, budN: 0 };
    rows.forEach((r) => { for (const [k] of MONEY) t[k] += num(r[k]) || 0; if ((num(r.budget) || 0) > 0) t.budN++; });
    return t;
  }
  // three money cards; prev = totals of the previous year (optional) for the change line
  function moneyCards(t, label, prev, prevY, whole) {
    const d = (k) => {
      if (!prev) return "";
      const diff = t[k] - prev[k];
      if (!diff) return `<div class="sub delta-line">ללא שינוי לעומת ${prevY}</div>`;
      return `<div class="sub delta-line">${diff > 0 ? "▲" : "▼"} ${shekel(Math.abs(diff))} לעומת ${prevY}</div>`;
    };
    const of = (k) => (whole ? `<div class="sub filt-line">לפי הסינון · מתוך ${shekel(whole[k])} בכל השנה</div>` : "");
    return `<div class="kpis money-row ${whole ? "filtered" : ""}" aria-label="סיכום כספי ${esc(label)}">
      <div class="kpi money" data-k="budget"><div class="lbl">תקציב מתוכנן</div><div class="val">${shekel(t.budget)}</div>
        <div class="sub">${t.budN} משימות עם תקציב</div>${d("budget")}${of("budget")}</div>
      <div class="kpi money" data-k="expense"><div class="lbl">הוצאה בפועל</div><div class="val">${shekel(t.expense)}</div>
        <div class="sub">${t.budget ? `${Math.round((t.expense / t.budget) * 100)}% מהתקציב · יתרה ${shekel(t.budget - t.expense)}` : "&nbsp;"}</div>${d("expense")}${of("expense")}</div>
      <div class="kpi money" data-k="income"><div class="lbl">הכנסה בפועל</div><div class="val">${shekel(t.income)}</div>
        <div class="sub">${t.income || t.expense ? `מאזן (הכנסה פחות הוצאה): ${shekel(t.income - t.expense)}` : "&nbsp;"}</div>${d("income")}${of("income")}</div>
    </div>`;
  }
  // grouped columns: one group per year, bars = budget / expense / income (SVG, RTL: earliest year on the right)
  // money views (dashboard, compare) can be narrowed to one priority
  const moneyRows = (y) => S.docs[y].rows.filter((r) => !S.moneyPrio || (S.moneyPrio === "none" ? !r.priority : String(r.priority) === S.moneyPrio));
  function moneyPrioSelect() {
    const all = [...new Set(S.years.flatMap((y) => (S.docs[y] ? S.docs[y].rows : []).map((r) => r.priority).filter(Boolean)))].sort();
    return `<label class="mprio"><span>סינון לפי קדימות</span><select class="input" data-mprio aria-label="סינון הסיכום הכספי לפי קדימות">
      <option value="">כל הקדימויות</option>${all.map((p) => `<option value="${esc(p)}" ${S.moneyPrio === p ? "selected" : ""}>קדימות ${esc(p)}</option>`).join("")}
      <option value="none" ${S.moneyPrio === "none" ? "selected" : ""}>ללא קדימות</option></select></label>`;
  }
  const moneyPrioNote = () => (S.moneyPrio ? ` · ${S.moneyPrio === "none" ? "משימות ללא קדימות" : `קדימות ${esc(S.moneyPrio)} בלבד`}` : "");
  // money breakdown: section -> task -> task detail (rows), totals at every level
  function moneyTree(y) {
    const doc = S.docs[y];
    const rows = moneyRows(y);
    const hasMoney = (t) => t.budget || t.expense || t.income;
    const showAll = !!S.treeAll;
    const cell = (t) => MONEY.map(([k]) => `<td class="num">${t[k] ? shekel(t[k]) : `<span class="muted">—</span>`}</td>`).join("") +
      `<td class="num">${t.budget ? `${Math.round((t.expense / t.budget) * 100)}%` : `<span class="muted">—</span>`}</td>`;
    let html = "", n = 0;
    doc.sections.forEach((sec, si) => {
      const sr = rows.filter((r) => r.sectionId === sec.id);
      const st = moneyTotals(sr);
      if (!showAll && !hasMoney(st)) return;
      const sid = `t${si}`;
      const tasks = [];
      sr.forEach((r) => { const name = (r.task || "").trim() || "(ללא שם משימה)"; let g = tasks.find((x) => x.name === name); if (!g) tasks.push((g = { name, rows: [] })); g.rows.push(r); });
      const open = S.treeOpen.has(sid);
      html += `<tr class="lv1" data-node="${sid}"><td><button class="tg-btn" data-tg="${sid}" aria-expanded="${open}">${open ? "▾" : "◂"}</button><span class="sec-num sm">${si + 1}</span>${esc(sec.title.trim())}</td>${cell(st)}</tr>`;
      tasks.forEach((g, ti) => {
        const tt = moneyTotals(g.rows);
        if (!showAll && !hasMoney(tt)) return;
        const tid = `${sid}-${ti}`, topen = S.treeOpen.has(tid);
        html += `<tr class="lv2 ${open ? "" : "hidden"}" data-parent="${sid}" data-node="${tid}" data-name="${esc(g.name)}"><td><button class="tg-btn" data-tg="${tid}" aria-expanded="${topen}">${topen ? "▾" : "◂"}</button>${esc(g.name)} <span class="muted cnt">${g.rows.length}</span></td>${cell(tt)}</tr>`;
        g.rows.forEach((r) => {
          const rt = moneyTotals([r]);
          if (!showAll && !hasMoney(rt)) return;
          const label = String(r.taskDetail || "").split("\n")[0].trim() || String(r.task || "").trim() || "—";
          html += `<tr class="lv3 ${open && topen ? "" : "hidden"}" data-parent="${tid}" data-row="${esc(r.id)}"><td title="${esc(r.taskDetail || "")}"><span class="dot-st" style="background:${stColor[r.status] || "#999"}"></span>${esc(label)}${r.owner ? ` <span class="muted cnt">· ${esc(r.owner)}</span>` : ""}</td>${cell(rt)}</tr>`;
          n++;
        });
      });
    });
    const tot = moneyTotals(rows);
    return `<div class="tree-tools"><button class="btn sm" data-tree="open">פתיחת הכול</button><button class="btn sm" data-tree="close">סגירת הכול</button>
        <label class="chk"><input type="checkbox" data-tree="all" ${showAll ? "checked" : ""}> הצגת סעיפים ומשימות בלי סכומים</label></div>
      <div style="overflow-x:auto"><table class="simple mtree"><thead><tr><th>סעיף › משימה › פירוט</th>${MONEY.map(([, l, c]) => `<th class="num"><span class="sw" style="background:${c}"></span>${l}</th>`).join("")}<th class="num">ניצול</th></tr></thead>
      <tbody>${html || `<tr><td colspan="5" class="empty">אין סכומים ${esc(y)}${moneyPrioNote()}</td></tr>`}</tbody>
      <tfoot><tr><td>סה״כ ${esc(y)}${moneyPrioNote()}</td>${cell(tot)}</tr></tfoot></table></div>`;
  }
  function bindTree(root, y, rerender) {
    root.querySelectorAll("[data-tree]").forEach((el) => {
      const a = el.dataset.tree;
      if (a === "all") el.onchange = () => { S.treeAll = el.checked; rerender(); };
      else el.onclick = () => {
        if (a === "open") root.querySelectorAll("[data-node]").forEach((n) => S.treeOpen.add(n.dataset.node));
        else S.treeOpen.clear();
        rerender();
      };
    });
    root.querySelector(".mtree").onclick = (e) => {
      const t = e.target.closest("[data-tg]");
      if (t) { const id = t.dataset.tg; S.treeOpen.has(id) ? S.treeOpen.delete(id) : S.treeOpen.add(id); return rerender(); }
      const r = e.target.closest("tr[data-row]");
      if (r) openRow(y, r.dataset.row);
    };
  }
  function moneyChart(years, focus) {
    const data = years.map((y) => ({ y, t: moneyTotals(moneyRows(y)) }));
    const max = Math.max(1, ...data.flatMap((d) => MONEY.map(([k]) => d.t[k])));
    const pow = Math.pow(10, Math.floor(Math.log10(max)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((st) => max / st <= 5) || pow * 10;
    const top = Math.ceil(max / step) * step;
    const W = 1000, H = 300, padL = 64, padB = 30, padT = 18;
    const gw = (W - padL - 8) / data.length, bw = Math.min(40, (gw * 0.6) / 3);
    const yv = (v) => padT + (H - padT - padB) * (1 - v / top);
    const kfmt = (v) => (v >= 1000 ? `₪${(v / 1000).toLocaleString("he-IL", { maximumFractionDigits: 1 })}K` : `₪${v}`);
    let g = "";
    for (let v = 0; v <= top + 1e-9; v += step) g += `<line x1="${padL}" x2="${W - 4}" y1="${yv(v)}" y2="${yv(v)}" stroke="#E7E9F1"/><text x="${padL - 8}" y="${yv(v) + 4}" text-anchor="end" class="ax">${kfmt(v)}</text>`;
    data.forEach((d, i) => {
      const cx = W - 8 - gw * i - gw / 2;
      if (d.y === focus) g += `<rect x="${cx - gw / 2 + 4}" y="${padT - 8}" width="${gw - 8}" height="${H - padT - padB + 8}" rx="8" fill="#F1F2FB"/>`;
      MONEY.forEach(([k, label, color], j) => {
        // RTL inside the group too: budget on the right
        const x = cx + bw * 1.5 - bw * (j + 1) + 0 - (j - 1) * 2;
        const v = d.t[k], h = yv(0) - yv(v);
        if (v > 0) {
          const hh = Math.max(h, 2);
          g += `<path class="seg" d="M${x},${yv(0)} v${-(hh - Math.min(4, hh))} q0,${-Math.min(4, hh)} ${Math.min(4, bw / 2)},${-Math.min(4, hh)} h${bw - 2 * Math.min(4, bw / 2)} q${Math.min(4, bw / 2)},0 ${Math.min(4, bw / 2)},${Math.min(4, hh)} v${hh - Math.min(4, hh)} z" fill="${color}" data-mtip="${d.y}|${label}|${v}|${color}"/>`;
        } else {
          g += `<line x1="${x}" x2="${x + bw}" y1="${yv(0) - 1}" y2="${yv(0) - 1}" stroke="${color}" stroke-width="2" data-mtip="${d.y}|${label}|0|${color}"/>`;
        }
      });
      g += `<text x="${cx}" y="${H - 8}" text-anchor="middle" class="ax ${d.y === focus ? "ax-on" : ""}">${d.y}</text>`;
    });
    const legend = `<div class="legend">${MONEY.map(([, l, c]) => `<span style="--c:${c}">${l}</span>`).join("")}</div>`;
    const table = `<table class="simple dtable"><thead><tr><th>שנה</th>${MONEY.map(([, l]) => `<th>${l}</th>`).join("")}<th>מאזן</th><th>ניצול תקציב</th></tr></thead><tbody>${data.map((d) => `<tr><td><b>${d.y}</b></td>${MONEY.map(([k]) => `<td>${shekel(d.t[k])}</td>`).join("")}<td>${shekel(d.t.income - d.t.expense)}</td><td>${d.t.budget ? Math.round((d.t.expense / d.t.budget) * 100) + "%" : "—"}</td></tr>`).join("")}</tbody></table>`;
    return { svg: `<svg viewBox="0 0 ${W} ${H}" class="cols" role="img" aria-label="תקציב, הוצאה והכנסה לפי שנה">${g}</svg>${legend}`, table };
  }
  const canEdit = () => S.user && (S.user.role === "admin" || S.user.role === "editor");
  const isAdmin = () => S.user && S.user.role === "admin";

  async function api(path, opts = {}) {
    const res = await fetch("/api/" + path, {
      method: opts.method || "GET",
      headers: { "content-type": "application/json", ...(S.token ? { authorization: "Bearer " + S.token } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && path !== "login") { logout(); throw new Error(data.error || "נדרשת התחברות"); }
    if (!res.ok) throw new Error(data.error || "שגיאה");
    return data;
  }

  // ---------- auth ----------
  function renderLogin() {
    $app.innerHTML = `
      <div class="login-wrap"><form class="login-card" id="loginForm">
        <img src="/logo.png" alt="ITCB">
        <h1>תוכנית שיווק ושימור שותפים</h1>
        <p class="sub">כניסה למערכת הניהול של ITCB</p>
        <div class="field"><label for="u">מייל</label><input class="input" id="u" type="email" autocomplete="username" dir="ltr" required></div>
        <div class="field"><label for="p">סיסמה</label><input class="input" id="p" type="password" autocomplete="current-password" dir="ltr" required></div>
        <div class="err" id="loginErr"></div>
        <button class="btn primary block" type="submit">כניסה</button>
      </form></div>`;
    document.getElementById("loginForm").onsubmit = async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector("button"); btn.disabled = true;
      try {
        const r = await api("login", { method: "POST", body: { username: document.getElementById("u").value, password: document.getElementById("p").value } });
        S.token = r.token; S.user = r.user; store.set("itcb_token", r.token);
        if (r.user.mustChange) return renderFirstPassword(document.getElementById("p").value);
        await boot();
      } catch (er) { document.getElementById("loginErr").textContent = er.message; btn.disabled = false; }
    };
  }
  function logout() { S.token = null; S.user = null; store.del("itcb_token"); S.docs = {}; renderLogin(); }

  // first login: user must pick their own password (v1.7)
  function renderFirstPassword(temp) {
    $app.innerHTML = `
      <div class="login-wrap"><form class="login-card" id="fpForm">
        <img src="/logo.png" alt="ITCB">
        <h1>ברוך הבא, ${esc(S.user.name)}</h1>
        <p class="sub">לפני הכניסה הראשונה, בחר סיסמה אישית. הסיסמה הזמנית שקיבלת תפסיק לעבוד.</p>
        <div class="field ${temp ? "hidden" : ""}"><label for="fpCur">הסיסמה הזמנית שקיבלת</label><input class="input" id="fpCur" type="password" dir="ltr" autocomplete="current-password" value="${esc(temp)}" required></div>
        <div class="field"><label for="fpNew">סיסמה חדשה (8 תווים לפחות)</label><input class="input" id="fpNew" type="password" dir="ltr" minlength="8" autocomplete="new-password" required></div>
        <div class="field"><label for="fpAgain">אימות הסיסמה החדשה</label><input class="input" id="fpAgain" type="password" dir="ltr" autocomplete="new-password" required></div>
        <div class="err" id="fpErr"></div>
        <button class="btn primary block" type="submit">שמירה וכניסה</button>
        <button class="btn ghost block" type="button" id="fpOut" style="margin-top:8px">יציאה</button>
      </form></div>`;
    document.getElementById("fpOut").onclick = logout;
    document.getElementById("fpForm").onsubmit = async (e) => {
      e.preventDefault();
      const n = document.getElementById("fpNew").value, a = document.getElementById("fpAgain").value, err = document.getElementById("fpErr");
      if (n !== a) { err.textContent = "הסיסמאות אינן תואמות"; return; }
      const btn = e.target.querySelector('[type="submit"]'); btn.disabled = true;
      try {
        await api("password", { method: "POST", body: { current: document.getElementById("fpCur").value, next: n } });
        toast("הסיסמה נשמרה"); await boot();
      } catch (er) { err.textContent = er.message; btn.disabled = false; if (/נוכחית/.test(er.message)) document.getElementById("fpCur").parentElement.classList.remove("hidden"); }
    };
    document.getElementById(temp ? "fpNew" : "fpCur").focus();
  }

  async function boot() {
    if (!S.token) return renderLogin();
    $app.innerHTML = `<div class="loading">טוען…</div>`;
    try {
      const me = await api("me");
      S.user = me.user;
      if (S.user.mustChange) return renderFirstPassword("");
      const ys = await api("years");
      S.years = ys.years;
      S.sort = store.get("itcb_sort") || "plan";
      S.moneyPrio = store.get("itcb_mprio") || "";
      const saved = store.get("itcb_view");
      const thisYear = String(new Date().getFullYear());
      S.view = saved && (S.years.includes(saved) || ["compare", "users", "dash", "gantt"].includes(saved)) ? saved
        : S.years.includes(thisYear) ? thisYear : S.years[S.years.length - 1];
      if (S.view === "users" && !isAdmin()) S.view = S.years[S.years.length - 1];
      renderShell();
    } catch (e) { if (S.token) $app.innerHTML = `<div class="loading">${esc(e.message)}</div>`; }
  }

  // ---------- shell ----------
  function renderShell() {
    const initials = (S.user.name || S.user.username).trim().slice(0, 1).toUpperCase();
    $app.innerHTML = `
      <header class="top">
        <div class="top-inner">
          <button class="burger" id="burger" aria-label="פתיחת התפריט" aria-expanded="false" aria-controls="sideNav"><span></span><span></span><span></span></button>
          <img src="/logo.png" alt="ITCB">
          <div class="top-title"><b>תוכנית שיווק ושימור שותפים</b><span>Israeli Testing Certification Board</span></div>
          <div class="spacer"></div>
          <div class="user-chip" id="userChip">
            <span class="uname">${esc(S.user.name)}</span><span class="role-tag">${ROLE_LABEL[S.user.role]}</span>
            <button class="avatar" style="border:0" id="userBtn" aria-label="תפריט משתמש">${esc(initials)}</button>
            <div class="menu hidden" id="userMenu">
              <button data-act="pw">שינוי סיסמה</button>
              ${isAdmin() ? `<button data-act="users">ניהול משתמשים</button>` : ""}
              <button data-act="logout">יציאה</button>
            </div>
          </div>
        </div>
        <nav class="tabs" id="tabs"></nav>
      </header>
      <div class="side-ov hidden" id="sideOv"></div>
      <aside class="side-nav" id="sideNav" aria-label="תפריט ראשי" aria-hidden="true"></aside>
      <main id="main"></main>
      <footer class="ver">ITCB · גרסה ${VERSION}</footer>`;
    const menu = document.getElementById("userMenu");
    document.getElementById("userBtn").onclick = (e) => { e.stopPropagation(); menu.classList.toggle("hidden"); };
    document.addEventListener("click", () => menu.classList.add("hidden"));
    menu.onclick = (e) => {
      const a = e.target.dataset.act;
      if (a === "logout") logout();
      if (a === "pw") openPassword();
      if (a === "users") go("users");
    };
    document.getElementById("burger").onclick = () => toggleSide(true);
    document.getElementById("sideOv").onclick = () => toggleSide(false);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") toggleSide(false); });
    renderTabs(); renderView();
  }
  function toggleSide(open) {
    const nav = document.getElementById("sideNav"), ov = document.getElementById("sideOv"), b = document.getElementById("burger");
    if (!nav) return;
    nav.classList.toggle("open", open); ov.classList.toggle("hidden", !open);
    nav.setAttribute("aria-hidden", String(!open)); b.setAttribute("aria-expanded", String(open));
    document.body.classList.toggle("no-scroll", open);
    if (open) { const a = nav.querySelector(".active") || nav.querySelector("button"); a && a.focus(); }
  }
  function renderTabs() {
    const t = document.getElementById("tabs");
    t.innerHTML = S.years.map((y) => `<button data-v="${y}" class="${S.view === y ? "active" : ""}">${y}</button>`).join("")
      + `<span class="sep"></span><button data-v="dash" class="${S.view === "dash" ? "active" : ""}">דשבורד</button><button data-v="gantt" class="${S.view === "gantt" ? "active" : ""}">גאנט</button><button data-v="compare" class="${S.view === "compare" ? "active" : ""}">השוואה בין שנים</button>`
      + (isAdmin() ? `<button data-v="users" class="${S.view === "users" ? "active" : ""}">ניהול משתמשים</button>
                      <button data-v="addyear" title="הוספת שנה חדשה">+ שנה</button>` : "");
    t.onclick = (e) => {
      const v = e.target.dataset.v; if (!v) return;
      if (v === "addyear") return openAddYear();
      go(v);
    };
    // mobile side menu – same destinations, grouped
    const nav = document.getElementById("sideNav");
    if (nav) {
      const item = (v, label, icon) => `<button data-v="${v}" class="${S.view === v ? "active" : ""}"><span class="si">${icon}</span>${label}</button>`;
      nav.innerHTML = `
        <div class="side-head"><img src="/logo.png" alt="ITCB"><button class="btn ghost sm" data-close aria-label="סגירת התפריט">✕</button></div>
        <div class="side-user"><span class="avatar">${esc((S.user.name || "?").trim().slice(0, 1))}</span><div><b>${esc(S.user.name)}</b><div class="muted" style="font-size:12px">${ROLE_LABEL[S.user.role]}</div></div></div>
        <div class="side-group">תוכנית לפי שנה</div>
        ${S.years.map((y) => item(y, `תוכנית ${y}`, "📋")).join("")}
        <div class="side-group">תצוגות</div>
        ${item("dash", "דשבורד", "📊")}${item("gantt", "גאנט", "🗓️")}${item("compare", "השוואה בין שנים", "⇄")}
        ${isAdmin() ? `<div class="side-group">ניהול</div>${item("users", "ניהול משתמשים", "👥")}${item("addyear", "הוספת שנה", "＋")}` : ""}
        <div class="side-group">חשבון</div>
        <button data-act="pw"><span class="si">🔑</span>שינוי סיסמה</button>
        <button data-act="logout"><span class="si">↩</span>יציאה</button>
        <div class="side-ver">גרסה ${VERSION}</div>`;
      nav.onclick = (e) => {
        const b = e.target.closest("button"); if (!b) return;
        if (b.hasAttribute("data-close")) return toggleSide(false);
        const v = b.dataset.v, a = b.dataset.act;
        toggleSide(false);
        if (v === "addyear") return openAddYear();
        if (v) return go(v);
        if (a === "pw") openPassword();
        if (a === "logout") logout();
      };
    }
  }
  // re-render whatever view is open after data changed (year table, gantt, dashboard…)
  function refreshView(y) {
    const m = document.getElementById("main");
    if (S.view === y) return renderYear(m, y);
    renderView();
  }
  function go(v) { S.view = v; store.set("itcb_view", v); renderTabs(); renderView(); window.scrollTo(0, 0); }
  async function renderView() {
    const m = document.getElementById("main");
    if (S.view === "users") return renderUsers(m);
    if (S.view === "compare") return renderCompare(m);
    if (S.view === "dash") return renderDash(m);
    if (S.view === "gantt") return renderGantt(m);
    if (!S.docs[S.view]) {
      m.innerHTML = `<div class="loading">טוען את ${esc(S.view)}…</div>`;
      try { S.docs[S.view] = await api("year/" + S.view); } catch (e) { m.innerHTML = `<div class="loading">${esc(e.message)}</div>`; return; }
    }
    renderYear(m, S.view);
  }

  // ---------- year view ----------
  function counts(rows) {
    const c = { total: rows.length };
    STATUSES.forEach((s) => (c[s] = 0));
    rows.forEach((r) => (c[r.status] = (c[r.status] || 0) + 1));
    return c;
  }
  function stackBar(c, cls = "bar") {
    if (!c.total) return `<div class="${cls}"></div>`;
    return `<div class="${cls}">${["הסתיים", "בעבודה", "הועבר לשנה אחרי", "לא החל", "בוטל"].map((s) => c[s] ? `<i title="${s}: ${c[s]}" style="width:${(c[s] / c.total) * 100}%;background:${stColor[s]}"></i>` : "").join("")}</div>`;
  }
  function owners(rows) {
    const set = new Set();
    rows.forEach((r) => String(r.owner || "").split(/[,،\n]/).map((s) => s.trim()).filter(Boolean).forEach((o) => set.add(o)));
    return [...set].sort((a, b) => a.localeCompare(b, "he"));
  }
  // column filter types: select = exact value from list, text = contains
  const SELECT_COLS = { status: 1, owner: 1, priority: 1, date: 1 };
  const isFiltering = () => !!(S.filters.q || S.filters.section || Object.values(S.filters.cols).some(Boolean));
  function colValues(rows, k) {
    if (k === "owner") return owners(rows);
    if (k === "date") {
      const set = new Set();
      rows.forEach((r) => String(r.date || "").split(/\n/).map((x) => x.trim()).filter(Boolean).forEach((d) => set.add(d)));
      return [...set].sort((a, b) => dateKey(a) - dateKey(b));
    }
    if (k === "status") return [...new Set([...STATUSES.filter((x) => rows.some((r) => r.status === x)), ...rows.map((r) => r.status).filter(Boolean)])];
    return [...new Set(rows.map((r) => String(r[k] || "")).filter(Boolean))].sort();
  }
  function matches(r) {
    const f = S.filters;
    if (f.section && r.sectionId !== f.section) return false;
    for (const [k, v] of Object.entries(f.cols)) {
      if (!v) continue;
      const val = String(r[k] || "");
      if (v === "__empty") { if (val.trim()) return false; continue; }
      if (k === "owner" || k === "date") { if (!val.split(/[,،\n]/).map((x) => x.trim()).includes(v)) return false; }
      else if (SELECT_COLS[k]) { if (val !== v) return false; }
      else if (!val.toLowerCase().includes(v.toLowerCase())) return false;
    }
    if (f.q) {
      const q = f.q.toLowerCase();
      if (!COLS.some(([k]) => String(r[k] || "").toLowerCase().includes(q))) return false;
    }
    return true;
  }
  // "03.2027" / "12.12.2027" / "שנתי" -> sortable number (unknown last)
  function dateKey(d) {
    const m = String(d || "").match(/(?:(\d{1,2})\.)?(\d{1,2})\.(\d{4})/);
    if (!m) return 99999999;
    return Number(m[3]) * 10000 + Number(m[2]) * 100 + Number(m[1] || 0);
  }
  function sortRows(rows) {
    const out = rows.slice();
    if (S.sort === "priority") out.sort((a, b) => (Number(a.priority) || 99) - (Number(b.priority) || 99) || dateKey(a.date) - dateKey(b.date));
    if (S.sort === "date") out.sort((a, b) => dateKey(a.date) - dateKey(b.date) || (Number(a.priority) || 99) - (Number(b.priority) || 99));
    if (S.sort === "status") out.sort((a, b) => (STATUSES.indexOf(a.status) + 1 || 99) - (STATUSES.indexOf(b.status) + 1 || 99));
    return out;
  }

  function renderYear(m, y) {
    const doc = S.docs[y];
    const c = counts(doc.rows);
    const pct = c.total ? Math.round((c["הסתיים"] / c.total) * 100) : 0;
    const inc = doc.rows.reduce((a, r) => a + (num(r.income) || 0), 0);
    const exp = doc.rows.reduce((a, r) => a + (num(r.expense) || 0), 0);
    const f = S.filters;
    const activeCount = Object.values(f.cols).filter(Boolean).length + (f.section ? 1 : 0);

    m.innerHTML = `
      <div class="kpis">
        <div class="kpi progress"><div class="lbl">התקדמות ${esc(y)}</div>
          <div class="val">${pct}% <small>הושלמו (${c["הסתיים"]} מתוך ${c.total})</small></div>
          ${stackBar(c)}
          <div class="legend">${["הסתיים", "בעבודה", "הועבר לשנה אחרי", "לא החל"].map((s) => `<span style="--c:${stColor[s]}">${s}</span>`).join("")}</div>
        </div>
        <div class="kpi"><div class="lbl">משימות</div><div class="val">${c.total}</div></div>
        <div class="kpi"><div class="lbl">בעבודה</div><div class="val" style="color:var(--work)">${c["בעבודה"]}</div></div>
        <div class="kpi"><div class="lbl">לא החל</div><div class="val" style="color:var(--todo)">${c["לא החל"]}</div></div>
        <div class="kpi"><div class="lbl">הועבר לשנה אחרי</div><div class="val" style="color:var(--moved)">${c["הועבר לשנה אחרי"]}</div></div>
      </div>
      <div id="moneyBox"></div>
      <div class="toolbar">
        <input class="input search" id="fq" placeholder="חיפוש בכל השדות…" value="${esc(f.q)}">
        <select class="input" id="fp" aria-label="קדימות"><option value="">כל הקדימויות</option>${colValues(doc.rows, "priority").map((p) => `<option value="${esc(p)}" ${f.cols.priority === p ? "selected" : ""}>קדימות ${esc(p)}</option>`).join("")}</select>
        <select class="input" id="fsort" aria-label="מיון">
          ${[["plan", "סדר התוכנית (לפי סעיפים)"], ["priority", "מיון לפי קדימות"], ["date", "מיון לפי תאריך"], ["status", "מיון לפי סטטוס"]].map(([v, l]) => `<option value="${v}" ${S.sort === v ? "selected" : ""}>${l}</option>`).join("")}
        </select>
        <button class="btn sm ${S.showColFilters ? "primary" : ""}" id="colToggle">סינון לפי עמודות${activeCount ? ` (${activeCount})` : ""}</button>
        ${isFiltering() ? `<button class="btn ghost sm" id="fclear">ניקוי סינון</button>` : ""}
        ${S.sort === "plan" ? `<button class="btn sm" id="toggleAll">${S.collapsed.size ? "פתיחת כל הסעיפים" : "כיווץ כל הסעיפים"}</button>` : ""}
        <button class="btn sm" id="exportCsv">ייצוא ל-Excel</button>
        ${canEdit() ? `<button class="btn sm" id="addSec">+ סעיף</button><button class="btn accent sm" id="addRow">+ משימה</button>` : ""}
      </div>
      ${S.showColFilters ? `<div class="colfilters" id="colFilters">
        <div class="field"><label>סעיף</label><select class="input" data-sec-filter><option value="">הכול</option>${doc.sections.map((sc, i) => `<option value="${sc.id}" ${f.section === sc.id ? "selected" : ""}>${i + 1}. ${esc(sc.title.slice(0, 60))}</option>`).join("")}</select></div>
        ${COLS.map(([k, l]) => `<div class="field"><label>${l}</label>${SELECT_COLS[k]
          ? `<select class="input" data-col="${k}"><option value="">הכול</option>${colValues(doc.rows, k).map((v) => `<option value="${esc(v)}" ${f.cols[k] === v ? "selected" : ""}>${esc(v)}</option>`).join("")}<option value="__empty" ${f.cols[k] === "__empty" ? "selected" : ""}>(ריק)</option></select>`
          : `<input class="input" data-col="${k}" placeholder="מכיל…" value="${esc(f.cols[k] && f.cols[k] !== "__empty" ? f.cols[k] : "")}">`}</div>`).join("")}
      </div>` : ""}
      <div class="result-line" id="resultLine"></div>
      <div id="sections"></div>
      ${doc.updatedAt ? `<div class="audit" style="text-align:left">עודכן לאחרונה ${fmtDate(doc.updatedAt)}</div>` : ""}`;

    const rerender = () => renderSections(y);
    const fq = document.getElementById("fq");
    fq.oninput = () => { f.q = fq.value; rerender(); };
    document.getElementById("fp").onchange = (e) => { f.cols.priority = e.target.value; renderYear(m, y); };
    document.getElementById("fsort").onchange = (e) => { S.sort = e.target.value; store.set("itcb_sort", S.sort); renderYear(m, y); };
    document.getElementById("colToggle").onclick = () => { S.showColFilters = !S.showColFilters; renderYear(m, y); };
    const cf = document.getElementById("colFilters");
    if (cf) {
      cf.onchange = (e) => {
        const el = e.target;
        if (el.matches("[data-sec-filter]")) { f.section = el.value; return renderYear(m, y); }
        if (el.tagName === "SELECT" && el.dataset.col) { f.cols[el.dataset.col] = el.value; renderYear(m, y); }
      };
      cf.oninput = (e) => { const el = e.target; if (el.tagName === "INPUT" && el.dataset.col) { f.cols[el.dataset.col] = el.value; rerender(); } };
    }
    const fc = document.getElementById("fclear");
    if (fc) fc.onclick = () => { S.filters = { q: "", cols: {}, section: "" }; renderYear(m, y); };
    const ta = document.getElementById("toggleAll");
    if (ta) ta.onclick = () => {
      if (S.collapsed.size) S.collapsed.clear(); else doc.sections.forEach((s) => S.collapsed.add(y + s.id));
      renderYear(m, y);
    };
    document.getElementById("exportCsv").onclick = () => exportCsv(y);
    if (canEdit()) {
      document.getElementById("addRow").onclick = () => openRow(y, null, {});
      document.getElementById("addSec").onclick = () => openSection(y, null);
    }
    rerender();
  }

  function renderSections(y) {
    const doc = S.docs[y];
    const box = document.getElementById("sections");
    const filtering = isFiltering();
    const total = doc.rows.length, visible = doc.rows.filter(matches), shown = visible.length;
    const rl = document.getElementById("resultLine");
    if (rl) rl.textContent = filtering ? `מוצגות ${shown} מתוך ${total} משימות` : "";
    // money totals follow the active filters
    const mb = document.getElementById("moneyBox");
    if (mb) mb.innerHTML = moneyCards(moneyTotals(visible), y, null, null, filtering ? moneyTotals(doc.rows) : null);
    if (S.sort !== "plan") {
      const rows = sortRows(doc.rows.filter(matches));
      box.innerHTML = rows.length ? `<section class="section"><div class="sec-head" style="cursor:default"><h2>${{ priority: "כל המשימות לפי קדימות", date: "כל המשימות לפי תאריך", status: "כל המשימות לפי סטטוס" }[S.sort]}</h2><span class="sec-stats">${rows.length} משימות</span></div>${tableHtml(rows, true)}</section>`
        : `<div class="panel empty">לא נמצאו משימות שתואמות לסינון</div>`;
      bindTable(y, box);
      return;
    }
    let html = "";
    doc.sections.forEach((sec, i) => {
      const all = doc.rows.filter((r) => r.sectionId === sec.id);
      const rows = all.filter(matches);
      if (filtering && !rows.length) return;
      const c = counts(all);
      const collapsed = S.collapsed.has(y + sec.id) && !filtering;
      html += `<section class="section ${collapsed ? "collapsed" : ""}" data-sec="${sec.id}">
        <div class="sec-head" data-toggle="${sec.id}">
          <span class="sec-num">${i + 1}</span>
          <h2>${esc(sec.title)}</h2>
          <span class="sec-stats">${c["הסתיים"]}/${c.total} הושלמו ${stackBar(c, "mini")}</span>
          <span class="chev">▾</span>
        </div>
        <div class="sec-body">
          ${sec.detail ? `<details class="sec-detail"><summary>מטרות ופירוט הסעיף</summary>${esc(sec.detail.trim())}</details>` : ""}
          ${canEdit() ? `<div class="sec-actions"><button class="btn sm" data-addrow="${sec.id}">+ משימה בסעיף</button><button class="btn ghost sm" data-editsec="${sec.id}">עריכת הסעיף</button></div>` : ""}
          ${rows.length ? tableHtml(rows) : `<div class="empty">אין משימות בסעיף הזה</div>`}
        </div></section>`;
    });
    box.innerHTML = html || `<div class="panel empty">לא נמצאו משימות שתואמות לסינון</div>`;
    bindTable(y, box);
  }

  function bindTable(y, box) {
    const doc = S.docs[y];
    box.onclick = (e) => {
      const t = e.target;
      if (t.closest("select")) return;
      const tg = t.closest("[data-toggle]");
      if (tg) { const k = y + tg.dataset.toggle; S.collapsed.has(k) ? S.collapsed.delete(k) : S.collapsed.add(k); tg.parentElement.classList.toggle("collapsed"); return; }
      if (t.dataset.addrow) return openRow(y, null, { sectionId: t.dataset.addrow });
      if (t.dataset.editsec) return openSection(y, t.dataset.editsec);
      if (t.dataset.editrow) return openRow(y, t.dataset.editrow);
      if (t.dataset.delrow) {
        if (!confirmInline(t, "ללחוץ שוב למחיקה")) return;
        api(`year/${y}/row/${encodeURIComponent(t.dataset.delrow)}`, { method: "DELETE" })
          .then((d) => { S.docs[y] = d; toast("המשימה נמחקה"); refreshView(y); })
          .catch((er) => toast(er.message, true));
        return;
      }
      if (t.dataset.addsub) { const r = doc.rows.find((x) => x.id === t.dataset.addsub); return openRow(y, null, { sectionId: r.sectionId, task: r.task }); }
      const tr = t.closest("tr.row");
      if (tr) openRow(y, tr.dataset.id);
    };
    box.onchange = async (e) => {
      const sel = e.target.closest("select.pill-select"); if (!sel) return;
      const id = sel.dataset.id;
      try {
        S.docs[y] = await api(`year/${y}/row/${encodeURIComponent(id)}`, { method: "PUT", body: { status: sel.value } });
        toast("הסטטוס עודכן"); refreshView(y);
      } catch (er) { toast(er.message, true); }
    };
  }

  function tableHtml(rows, flat) {
    // group consecutive rows with the same task for rowspan
    const groups = [];
    rows.forEach((r) => {
      const g = groups[groups.length - 1];
      if (g && !flat && g.task === (r.task || "")) g.rows.push(r); else groups.push({ task: r.task || "", rows: [r] });
    });
    const secTitle = (r) => { const d = S.docs[S.view]; const i = d.sections.findIndex((x) => x.id === r.sectionId); return i < 0 ? "" : `${i + 1}. ${d.sections[i].title}`; };
    const head = (flat ? `<th>סעיף</th>` : "") + COLS.map(([k, l]) => `<th class="${k === "taskDetail" ? "col-detail" : k === "updates" ? "col-updates" : ""}">${l}</th>`).join("") + (canEdit() ? `<th class="col-actions">פעולות</th>` : "");
    let body = "";
    groups.forEach((g) => g.rows.forEach((r, i) => {
      body += `<tr class="row" data-id="${esc(r.id)}">` + (flat ? `<td><div class="clamp muted" style="max-width:160px;font-size:13px">${esc(secTitle(r))}</div></td>` : "");
      if (i === 0) body += `<td class="task-cell" rowspan="${g.rows.length}">${esc(g.task) || `<span class="muted">—</span>`}${canEdit() && !flat ? `<button class="add-sub" data-addsub="${esc(r.id)}">+ תת-משימה</button>` : ""}</td>`;
      body += `<td><div class="clamp">${esc(r.taskDetail)}</div></td>
        <td><div class="clamp">${esc(r.updates)}</div></td>
        <td>${canEdit()
          ? `<select class="pill pill-select ${stClass(r.status)}" data-id="${esc(r.id)}" aria-label="סטטוס">${statusOptions(r.status)}</select>`
          : `<span class="pill ${stClass(r.status)}">${esc(r.status || "—")}</span>`}</td>
        <td class="nowrap col-budget">${money(r.budget)}</td>
        <td class="nowrap">${esc(r.owner)}</td>
        <td><div class="clamp nowrap">${esc(r.date)}</div></td>
        <td>${r.priority ? `<span class="prio p${esc(r.priority)}">${esc(r.priority)}</span>` : ""}</td>
        <td>${esc(r.income)}</td><td>${esc(r.expense)}</td>
        <td><div class="clamp" style="max-width:180px">${esc(r.notes)}</div></td>
        ${canEdit() ? `<td class="col-actions"><div class="row-actions"><button class="icon-btn" data-editrow="${esc(r.id)}" title="עריכה / העברה לסעיף אחר" aria-label="עריכה">✎ עריכה</button><button class="icon-btn del" data-delrow="${esc(r.id)}" title="מחיקת המשימה" aria-label="מחיקה">🗑 מחיקה</button></div></td>` : ""}</tr>`;
    }));
    return `<div class="tbl-wrap"><table class="plan"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
  }
  function statusOptions(cur) {
    const list = STATUSES.includes(cur) || !cur ? STATUSES : [cur, ...STATUSES];
    return (cur ? "" : `<option value="" selected>—</option>`) + list.map((s) => `<option ${s === cur ? "selected" : ""}>${esc(s)}</option>`).join("");
  }

  // ---------- row drawer ----------
  function openRow(y, id, preset) {
    const doc = S.docs[y];
    const r = id ? doc.rows.find((x) => x.id === id) : { status: "לא החל", ...preset };
    if (!r) return;
    const edit = canEdit();
    const tasksIn = (sid) => [...new Set(doc.rows.filter((x) => x.sectionId === sid).map((x) => x.task).filter(Boolean))];
    const sec = doc.sections.find((s) => s.id === r.sectionId);
    const ov = document.createElement("div");
    ov.className = "overlay";
    const ro = (k, l) => `<div class="field"><label>${l}</label><div class="ro-val">${esc(r[k]) || `<span class="muted">—</span>`}</div></div>`;
    ov.innerHTML = `<div class="drawer" role="dialog" aria-modal="true">
      <div class="drawer-head"><h3>${id ? (edit ? "עריכת משימה" : "פרטי משימה") : "משימה חדשה"}</h3><button class="btn ghost sm" data-close aria-label="סגירה">✕</button></div>
      <div class="drawer-body">
      ${edit ? `
        <div class="field"><label>סעיף <span class="muted" style="font-weight:400">· כדי להעביר את המשימה לסעיף אחר, בחר אותו כאן</span></label><select class="input" name="sectionId">${doc.sections.map((s) => `<option value="${s.id}" ${s.id === r.sectionId ? "selected" : ""}>${esc(s.title)}</option>`).join("")}</select></div>
        <div class="field"><label>משימה</label><input class="input" name="task" list="taskList" value="${esc(r.task)}"><datalist id="taskList"></datalist></div>
        <div class="field"><label>פירוט המשימה</label><textarea class="input" name="taskDetail" rows="3">${esc(r.taskDetail)}</textarea></div>
        <div class="field"><label>עדכונים שוטפים</label><textarea class="input" name="updates" rows="5">${esc(r.updates)}</textarea></div>
        <div class="grid2">
          <div class="field"><label>סטטוס</label><select class="input" name="status">${statusOptions(r.status)}</select></div>
          <div class="field"><label>קדימות</label><select class="input" name="priority">${["", "1", "2", "3", "4", "5"].map((p) => `<option value="${p}" ${String(r.priority || "") === p ? "selected" : ""}>${p || "—"}</option>`).join("")}</select></div>
          <div class="field"><label>אחראי</label><input class="input" name="owner" list="ownerList" value="${esc(r.owner)}"><datalist id="ownerList">${owners(doc.rows).map((o) => `<option value="${esc(o)}">`).join("")}</datalist></div>
          <div class="field"><label>תאריך מתוכנן</label><input class="input" name="date" placeholder="לדוגמה 03.${esc(y)}" value="${esc(r.date)}"></div>
          <div class="field"><label>תחילת ביצוע <span class="muted" style="font-weight:400">· לגאנט</span></label><input class="input" type="date" name="startDate" value="${esc(r.startDate)}"></div>
          <div class="field"><label>סיום ביצוע <span class="muted" style="font-weight:400">· לגאנט</span></label><input class="input" type="date" name="endDate" value="${esc(r.endDate)}"></div>
        </div>
        <p class="audit" style="margin:-6px 0 12px">בגאנט: אם הוזנו תאריכי התחלה וסיום, המשימה תוצג לפיהם. אחרת היא תוצג לפי החודשים שבשדה "תאריך מתוכנן".</p>
        <div class="field"><label>תקציב (₪)</label><input class="input" name="budget" type="number" inputmode="decimal" min="0" step="any" dir="ltr" placeholder="סכום בש״ח, למשל 12000" value="${esc(num(r.budget) ?? "")}"></div>
        <div class="grid2">
          <div class="field"><label>הכנסה בפועל</label><input class="input" name="income" value="${esc(r.income)}"></div>
          <div class="field"><label>הוצאה בפועל</label><input class="input" name="expense" value="${esc(r.expense)}"></div>
        </div>
        <div class="field"><label>הערות</label><textarea class="input" name="notes" rows="2">${esc(r.notes)}</textarea></div>
      ` : `
        <div class="field"><label>סעיף</label><div class="ro-val">${esc(sec?.title)}</div></div>
        ${COLS.map(([k, l]) => ro(k, l)).join("")}
        ${r.startDate || r.endDate ? `<div class="field"><label>תקופת ביצוע</label><div class="ro-val">${esc(r.startDate ? new Date(r.startDate).toLocaleDateString("he-IL") : "")} – ${esc(r.endDate ? new Date(r.endDate).toLocaleDateString("he-IL") : "")}</div></div>` : ""}
      `}
        ${r.updatedAt ? `<div class="audit">עודכן לאחרונה ע״י ${esc(r.updatedBy)} · ${fmtDate(r.updatedAt)}</div>` : ""}
      </div>
      ${edit ? `<div class="drawer-foot"><button class="btn primary" data-save>שמירה</button><button class="btn" data-close>ביטול</button><span class="spacer"></span>${id ? `<button class="btn danger" data-del>מחיקת המשימה</button>` : ""}</div>` : ""}
    </div>`;
    document.body.appendChild(ov);
    const close = () => { ov.remove(); document.removeEventListener("keydown", onKey); };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    ov.addEventListener("mousedown", (e) => { if (e.target === ov) close(); });
    ov.querySelectorAll("[data-close]").forEach((b) => (b.onclick = close));
    if (!edit) return;
    const secSel = ov.querySelector('[name="sectionId"]');
    const fillTasks = () => (ov.querySelector("#taskList").innerHTML = tasksIn(secSel.value).map((t) => `<option value="${esc(t)}">`).join(""));
    secSel.onchange = fillTasks; fillTasks();
    ov.querySelector('[name="task"]').focus();
    ov.querySelector("[data-save]").onclick = async (e) => {
      const body = {};
      ov.querySelectorAll("[name]").forEach((el) => (body[el.name] = el.value));
      e.target.disabled = true;
      try {
        S.docs[y] = await api(`year/${y}/row${id ? "/" + encodeURIComponent(id) : ""}`, { method: id ? "PUT" : "POST", body });
        close(); toast(id ? "המשימה נשמרה" : "המשימה נוספה"); refreshView(y);
      } catch (er) { toast(er.message, true); e.target.disabled = false; }
    };
    const del = ov.querySelector("[data-del]");
    if (del) del.onclick = async () => {
      if (!confirmInline(del, "ללחוץ שוב למחיקה")) return;
      try { S.docs[y] = await api(`year/${y}/row/${encodeURIComponent(id)}`, { method: "DELETE" }); close(); toast("המשימה נמחקה"); refreshView(y); }
      catch (er) { toast(er.message, true); }
    };
  }
  // two-step confirm on the same button (avoids blocking browser dialogs)
  function confirmInline(btn, text) {
    if (btn.dataset.armed) return true;
    btn.dataset.armed = "1"; const old = btn.textContent; btn.textContent = text;
    setTimeout(() => { delete btn.dataset.armed; btn.textContent = old; }, 3000);
    return false;
  }

  // ---------- modals ----------
  function modal(title, inner, onSave, extraFoot = "") {
    const ov = document.createElement("div");
    ov.className = "overlay center";
    ov.innerHTML = `<form class="modal"><div class="drawer-head"><h3>${title}</h3><button type="button" class="btn ghost sm" data-close>✕</button></div>
      <div class="drawer-body">${inner}<div class="err" data-err></div></div>
      <div class="drawer-foot"><button class="btn primary" type="submit">שמירה</button><button type="button" class="btn" data-close>ביטול</button><span class="spacer"></span>${extraFoot}</div></form>`;
    document.body.appendChild(ov);
    const close = () => ov.remove();
    ov.addEventListener("mousedown", (e) => { if (e.target === ov) close(); });
    ov.querySelectorAll("[data-close]").forEach((b) => (b.onclick = close));
    const form = ov.querySelector("form");
    form.onsubmit = async (e) => {
      e.preventDefault();
      const btn = form.querySelector('[type="submit"]'); btn.disabled = true;
      try { await onSave(form, close); } catch (er) { form.querySelector("[data-err]").textContent = er.message; btn.disabled = false; }
    };
    const first = form.querySelector("input,textarea,select"); if (first) first.focus();
    return { ov, form, close };
  }

  function openSection(y, sid) {
    const doc = S.docs[y];
    const sec = sid ? doc.sections.find((s) => s.id === sid) : { title: "", detail: "" };
    const m = modal(sid ? "עריכת סעיף" : "סעיף חדש", `
      <div class="field"><label>שם הסעיף</label><input class="input" name="title" required value="${esc(sec.title)}"></div>
      <div class="field"><label>פירוט הסעיף ומטרות</label><textarea class="input" name="detail" rows="8">${esc(sec.detail)}</textarea></div>`,
      async (f, close) => {
        S.docs[y] = await api(`year/${y}/section${sid ? "/" + sid : ""}`, { method: sid ? "PUT" : "POST", body: { title: f.title.value, detail: f.detail.value } });
        close(); toast("הסעיף נשמר"); refreshView(y);
      }, sid ? `<button type="button" class="btn danger" data-delsec>מחיקת סעיף</button>` : "");
    const d = m.form.querySelector("[data-delsec]");
    if (d) d.onclick = async () => {
      if (!confirmInline(d, "ללחוץ שוב למחיקה")) return;
      try { S.docs[y] = await api(`year/${y}/section/${sid}`, { method: "DELETE" }); m.close(); toast("הסעיף נמחק"); refreshView(y); }
      catch (er) { m.form.querySelector("[data-err]").textContent = er.message; }
    };
  }

  function openPassword() {
    modal("שינוי סיסמה", `
      <div class="field"><label>סיסמה נוכחית</label><input class="input" type="password" name="current" required dir="ltr" autocomplete="current-password"></div>
      <div class="field"><label>סיסמה חדשה (8 תווים לפחות)</label><input class="input" type="password" name="next" required minlength="8" dir="ltr" autocomplete="new-password"></div>
      <div class="field"><label>אימות סיסמה חדשה</label><input class="input" type="password" name="again" required dir="ltr" autocomplete="new-password"></div>`,
      async (f, close) => {
        if (f.next.value !== f.again.value) throw new Error("הסיסמאות אינן תואמות");
        await api("password", { method: "POST", body: { current: f.current.value, next: f.next.value } });
        close(); toast("הסיסמה עודכנה");
      });
  }

  function openAddYear() {
    const last = S.years[S.years.length - 1];
    const next = String(Number(last) + 1);
    modal("הוספת שנה חדשה", `
      <div class="field"><label>שנה</label><input class="input" name="year" required pattern="20\\d\\d" value="${next}" dir="ltr"></div>
      <div class="field"><label>תוכן התחלתי</label><select class="input" name="copyFrom">
        ${S.years.slice().reverse().map((y) => `<option value="${y}">העתקת המשימות מ-${y}</option>`).join("")}
        <option value="">שנה ריקה</option></select></div>
      <label style="display:flex;gap:8px;align-items:center;font-size:14px"><input type="checkbox" name="keepUpdates"> להעתיק גם את העדכונים השוטפים</label>
      <p class="audit">בהעתקה, כל המשימות יקבלו סטטוס "לא החל", ההכנסות וההוצאות יתאפסו, והשנה בתאריכים תתעדכן לשנה החדשה.</p>`,
      async (f, close) => {
        const r = await api("years", { method: "POST", body: { year: f.year.value, copyFrom: f.copyFrom.value, keepUpdates: f.keepUpdates.checked } });
        S.years = r.years; close(); toast(`השנה ${f.year.value} נוספה`); go(f.year.value);
      });
  }

  // ---------- compare ----------
  async function renderCompare(m) {
    m.innerHTML = `<div class="loading">טוען…</div>`;
    try { await Promise.all(S.years.filter((y) => !S.docs[y]).map(async (y) => (S.docs[y] = await api("year/" + y)))); }
    catch (e) { m.innerHTML = `<div class="loading">${esc(e.message)}</div>`; return; }
    const cards = S.years.map((y) => {
      const d = S.docs[y]; const c = counts(d.rows);
      const pct = c.total ? Math.round((c["הסתיים"] / c.total) * 100) : 0;
      const mt = moneyTotals(moneyRows(y));
      return `<div class="kpi progress" style="cursor:pointer" data-go="${y}"><div class="lbl">${y}</div>
        <div class="val">${pct}% <small>הושלמו · ${c.total} משימות</small></div>${stackBar(c)}
        <div class="legend"><span style="--c:var(--done)">הסתיים ${c["הסתיים"]}</span><span style="--c:#E08A00">בעבודה ${c["בעבודה"]}</span><span style="--c:var(--moved)">הועבר ${c["הועבר לשנה אחרי"]}</span><span style="--c:#A3A8C0">לא החל ${c["לא החל"]}</span></div>
        <div class="cmp-money">${MONEY.map(([k, l, col]) => `<div data-k="${k}"><span class="sw" style="background:${col}"></span>${l}<b>${shekel(mt[k])}</b></div>`).join("")}
        ${S.moneyPrio ? `<div class="filt-line cmp-filt">לפי הסינון${moneyPrioNote()}</div>` : ""}</div></div>`;
    }).join("");
    // sections by title across years
    const titles = [];
    S.years.forEach((y) => S.docs[y].sections.forEach((s) => { if (!titles.includes(s.title.trim())) titles.push(s.title.trim()); }));
    const rows = titles.map((t) => `<tr><td style="font-weight:600;max-width:360px">${esc(t)}</td>${S.years.map((y) => {
      const d = S.docs[y]; const sec = d.sections.find((s) => s.title.trim() === t);
      if (!sec) return `<td class="muted">—</td>`;
      const c = counts(d.rows.filter((r) => r.sectionId === sec.id));
      return `<td><div style="display:flex;align-items:center;gap:8px">${stackBar(c, "cmp-bar")}<span class="nowrap muted">${c["הסתיים"]}/${c.total}</span></div></td>`;
    }).join("")}</tr>`).join("");
    const mc3 = moneyChart(S.years, null);
    m.innerHTML = `<div class="cmp-cards">${cards}</div>
      <div class="panel" id="cmpMoney"><div class="money-head"><h2>סיכום כספי לפי שנה${moneyPrioNote()}</h2>${moneyPrioSelect()}</div><p class="hint">תקציב מתוכנן, הוצאה בפועל והכנסה בפועל בכל שנה</p>
        <div style="overflow-x:auto">${mc3.table}</div></div>
      <div class="panel"><h2>התקדמות לפי סעיף</h2><p class="hint">משימות שהושלמו מתוך כלל המשימות בכל סעיף, לפי שנה</p>
      <div style="overflow-x:auto"><table class="simple"><thead><tr><th>סעיף</th>${S.years.map((y) => `<th>${y}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>
      <div class="legend" style="margin-top:12px">${["הסתיים", "בעבודה", "הועבר לשנה אחרי", "לא החל"].map((s) => `<span style="--c:${stColor[s]}">${s}</span>`).join("")}</div></div>`;
    m.onclick = (e) => { const g = e.target.closest("[data-go]"); if (g) go(g.dataset.go); };
    m.onchange = (e) => { if (e.target.matches("[data-mprio]")) { S.moneyPrio = e.target.value; store.set("itcb_mprio", S.moneyPrio); renderCompare(m); } };
  }

  // ---------- users ----------
  async function renderUsers(m) {
    m.onclick = null;
    m.innerHTML = `<div class="loading">טוען משתמשים…</div>`;
    try { S.users = (await api("users")).users; } catch (e) { m.innerHTML = `<div class="loading">${esc(e.message)}</div>`; return; }
    const roleSel = (u) => `<select class="input" style="width:auto" data-role="${esc(u.username)}">${Object.entries(ROLE_LABEL).map(([k, l]) => `<option value="${k}" ${u.role === k ? "selected" : ""}>${l}</option>`).join("")}</select>`;
    m.innerHTML = `
      <div class="panel">
        <h2>הוספת משתמש</h2><p class="hint">אחרי ההוספה תיפתח הזמנה מוכנה, עם קישור לאתר, המייל והסיסמה, לשליחה במייל או בוואטסאפ. המשתמש יוכל לשנות את הסיסמה בעצמו אחרי הכניסה.</p>
        <form class="add-user" id="addUser">
          <div class="field"><label>שם מלא</label><input class="input" name="name" required></div>
          <div class="field"><label>מייל</label><input class="input" name="username" type="email" required dir="ltr"></div>
          <div class="field"><label>טלפון <span class="muted" style="font-weight:400">· לוואטסאפ</span></label><input class="input" name="phone" type="tel" dir="ltr" placeholder="050-0000000"></div>
          <div class="field"><label>סיסמה זמנית <button type="button" class="linkbtn" id="genPw">יצירה אוטומטית</button></label><input class="input" name="password" required minlength="8" dir="ltr" value="${genPassword()}"></div>
          <div class="field"><label>הרשאה</label><select class="input" name="role"><option value="editor">עורך</option><option value="viewer">צופה</option><option value="admin">מנהל</option></select></div>
          <button class="btn accent" type="submit">הוספה</button>
        </form>
        <div class="roles-help">
          <div><b>מנהל</b>עריכת התוכנית, הוספת שנים וניהול משתמשים</div>
          <div><b>עורך</b>הוספה, עריכה ומחיקה של סעיפים ומשימות</div>
          <div><b>צופה</b>צפייה בלבד, בלי אפשרות לשנות</div>
        </div>
      </div>
      <div class="panel">
        <h2>משתמשים (${S.users.length})</h2>
        <div style="overflow-x:auto"><table class="simple"><thead><tr><th>שם</th><th>מייל</th><th>טלפון</th><th>הרשאה</th><th>כניסה אחרונה</th><th></th></tr></thead><tbody>
        ${S.users.map((u) => `<tr>
          <td><b>${esc(u.name)}</b>${u.username === S.user.username ? ` <span class="role-tag">את/ה</span>` : ""}</td>
          <td dir="ltr" style="text-align:right">${esc(u.username)}</td>
          <td dir="ltr" style="text-align:right" class="muted">${esc(u.phone || "—")}</td>
          <td>${roleSel(u)}</td>
          <td class="muted">${u.lastLogin ? fmtDate(u.lastLogin) : "טרם נכנס/ה"}${u.mustChange ? `<div class="audit">ממתין לבחירת סיסמה</div>` : ""}</td>
          <td class="nowrap">${u.username !== S.user.username ? `<button class="btn sm" data-invite="${esc(u.username)}">שליחת הזמנה</button>` : ""}<button class="btn sm" data-reset="${esc(u.username)}">איפוס סיסמה</button>
            ${u.username !== S.user.username ? `<button class="btn sm danger" data-deluser="${esc(u.username)}">מחיקה</button>` : ""}</td></tr>`).join("")}
        </tbody></table></div>
      </div>`;
    const f = document.getElementById("addUser");
    f.onsubmit = async (e) => {
      e.preventDefault();
      try {
        const inv = { name: f.name.value.trim(), email: f.username.value.trim().toLowerCase(), phone: f.phone.value.trim(), password: f.password.value, role: f.role.value };
        S.users = (await api("users", { method: "POST", body: { name: inv.name, username: inv.email, phone: inv.phone, password: inv.password, role: inv.role } })).users;
        toast("המשתמש נוסף"); renderUsers(m); openInvite(inv);
      } catch (er) { toast(er.message, true); }
    };
    document.getElementById("genPw").onclick = () => { f.password.value = genPassword(); };
    m.onchange = async (e) => {
      const u = e.target.dataset.role; if (!u) return;
      try { await api("users/" + encodeURIComponent(u), { method: "PUT", body: { role: e.target.value } }); toast("ההרשאה עודכנה"); }
      catch (er) { toast(er.message, true); renderUsers(m); }
    };
    m.onclick = async (e) => {
      const r = e.target.dataset.reset || e.target.dataset.invite, d = e.target.dataset.deluser;
      if (r) {
        const u = S.users.find((x) => x.username === r);
        const isInvite = !!e.target.dataset.invite;
        modal(isInvite ? `שליחת הזמנה · ${esc(u.name)}` : `איפוס סיסמה · ${esc(u.name)}`, `
          ${isInvite ? `<p class="hint" style="margin-top:0">מטעמי אבטחה הסיסמאות שמורות מוצפנות ואי אפשר לשלוף אותן, ולכן ההזמנה תכלול סיסמה ראשונית חדשה. הסיסמה הקודמת תפסיק לעבוד.</p>` : ""}
          <div class="field"><label>סיסמה חדשה (8 תווים לפחות) <button type="button" class="linkbtn" data-gen>יצירה אוטומטית</button></label><input class="input" name="pw" required minlength="8" dir="ltr" value="${genPassword()}"></div>`,
          async (fm, close) => {
            await api("users/" + encodeURIComponent(r), { method: "PUT", body: { password: fm.pw.value } });
            close(); toast("הסיסמה עודכנה");
            openInvite({ name: u.name, email: u.username, phone: u.phone, password: fm.pw.value, role: u.role }, !isInvite);
          }, "");
        const gb = document.querySelector(".modal [data-gen]");
        if (gb) gb.onclick = () => { document.querySelector('.modal [name="pw"]').value = genPassword(); };
      }
      if (d) {
        if (!confirmInline(e.target, "ללחוץ שוב")) return;
        try { S.users = (await api("users/" + encodeURIComponent(d), { method: "DELETE" })).users; toast("המשתמש נמחק"); renderUsers(m); }
        catch (er) { toast(er.message, true); }
      }
    };
  }

  // ---------- invitations (v1.6) ----------
  function genPassword() {
    const a = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
    const buf = new Uint32Array(10); crypto.getRandomValues(buf);
    return "Itcb-" + [...buf].map((n) => a[n % a.length]).join("");
  }
  // "050-123-4567" / "+972 50..." / "972..." -> "972501234567" ("" if invalid)
  function waNumber(raw) {
    let d = String(raw || "").replace(/[^\d+]/g, "");
    if (d.startsWith("+")) d = d.slice(1);
    else if (d.startsWith("00")) d = d.slice(2);
    else if (d.startsWith("0")) d = "972" + d.slice(1);
    return /^\d{9,15}$/.test(d) ? d : "";
  }
  function inviteText(u, reset) {
    const site = location.origin;
    return [
      `שלום ${u.name},`,
      "",
      reset ? "הסיסמה שלך למערכת ניהול תוכנית השיווק של ITCB אופסה." : "הוזמנת למערכת ניהול תוכנית השיווק ושימור השותפים של ITCB.",
      "",
      `כניסה: ${site}`,
      `מייל: ${u.email}`,
      `סיסמה זמנית: ${u.password}`,
      reset ? "" : `הרשאה: ${ROLE_LABEL[u.role] || u.role}`,
      "",
      "בכניסה הראשונה המערכת תבקש ממך לבחור סיסמה אישית, והסיסמה הזמנית תפסיק לעבוד.",
      "",
      `${S.user.name}`,
    ].filter((l, i, arr) => !(l === "" && arr[i - 1] === "")).join("\n");
  }
  function openInvite(u, reset) {
    const text = inviteText(u, reset);
    const subject = reset ? "ITCB · הסיסמה שלך אופסה" : "ITCB · הזמנה למערכת ניהול תוכנית השיווק";
    const ov = document.createElement("div");
    ov.className = "overlay center";
    ov.innerHTML = `<div class="modal" role="dialog" aria-modal="true" style="width:min(560px,100%)">
      <div class="drawer-head"><h3>${reset ? "הודעה על איפוס סיסמה" : "ההזמנה מוכנה לשליחה"}</h3><button class="btn ghost sm" data-close aria-label="סגירה">✕</button></div>
      <div class="drawer-body">
        <p class="hint" style="margin-top:0">המערכת לא שולחת מיילים בעצמה. בחר איך לשלוח את ההודעה ל-<b dir="ltr">${esc(u.email)}</b>:</p>
        <div class="field"><label>טלפון לוואטסאפ</label><input class="input" name="waPhone" type="tel" dir="ltr" placeholder="050-0000000" value="${esc(u.phone || "")}">
          <span class="audit" data-wa-hint></span></div>
        <textarea class="input invite-text" rows="11" dir="rtl">${esc(text)}</textarea>
        <div class="invite-actions">
          <a class="btn primary" data-mail href="mailto:${encodeURIComponent(u.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}">✉ פתיחה בתוכנת המייל</a>
          <a class="btn wa-btn" data-wa href="#" target="_blank" rel="noopener">שליחה בוואטסאפ</a>
          <button class="btn" data-copy>העתקת ההודעה</button>
        </div>
        <p class="audit">הסיסמה מוצגת רק עכשיו. אחרי סגירת החלון אי אפשר לראות אותה שוב, רק לאפס אותה.</p>
      </div></div>`;
    document.body.appendChild(ov);
    const ta = ov.querySelector(".invite-text");
    const close = () => ov.remove();
    ov.addEventListener("mousedown", (e) => { if (e.target === ov) close(); });
    ov.querySelector("[data-close]").onclick = close;
    const phoneIn = ov.querySelector('[name="waPhone"]'), wa = ov.querySelector("[data-wa]"), hint = ov.querySelector("[data-wa-hint]");
    // keep links in sync with the text and the phone
    const sync = () => {
      ov.querySelector("[data-mail]").href = `mailto:${encodeURIComponent(u.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(ta.value)}`;
      const intl = waNumber(phoneIn.value);
      wa.href = `https://wa.me/${intl}?text=${encodeURIComponent(ta.value)}`;
      hint.textContent = intl ? `ייפתח צ׳אט עם +${intl}` : (phoneIn.value.trim() ? "מספר לא תקין" : "בלי מספר, וואטסאפ יבקש לבחור איש קשר");
      hint.style.color = phoneIn.value.trim() && !intl ? "var(--danger)" : "";
    };
    ta.oninput = sync; phoneIn.oninput = sync; sync();
    // remember the phone on the user record for next time
    wa.addEventListener("click", (e) => {
      if (phoneIn.value.trim() && !waNumber(phoneIn.value)) { e.preventDefault(); phoneIn.focus(); return; }
      const ph = phoneIn.value.trim();
      if (ph && ph !== (u.phone || "")) {
        api("users/" + encodeURIComponent(u.email), { method: "PUT", body: { phone: ph } })
          .then((r) => { u.phone = ph; S.users = r.users; if (S.view === "users") renderUsers(document.getElementById("main")); }).catch(() => {});
      }
    });
    ov.querySelector("[data-copy]").onclick = async () => {
      try { await navigator.clipboard.writeText(ta.value); toast("ההודעה הועתקה"); }
      catch { ta.select(); document.execCommand("copy"); toast("ההודעה הועתקה"); }
    };
  }

  // ---------- export ----------
  function exportCsv(y) {
    const doc = S.docs[y];
    const head = ["סעיף", ...COLS.map(([, l]) => l)];
    const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [head.map(q).join(",")];
    doc.rows.forEach((r) => {
      const sec = doc.sections.find((s) => s.id === r.sectionId);
      lines.push([sec ? sec.title : "", ...COLS.map(([k]) => r[k])].map(q).join(","));
    });
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `ITCB-תוכנית-שיווק-${y}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
  }

  // =====================================================================
  // Dashboard + presentation mode (v1.3)
  // =====================================================================
  const ST_ORDER = ["הסתיים", "בעבודה", "הועבר לשנה אחרי", "לא החל", "בוטל"];
  const MONTHS_HE = ["ינו׳", "פבר׳", "מרץ", "אפר׳", "מאי", "יוני", "יולי", "אוג׳", "ספט׳", "אוק׳", "נוב׳", "דצמ׳"];
  async function ensureDocs(years) {
    await Promise.all(years.filter((y) => !S.docs[y]).map(async (y) => (S.docs[y] = await api("year/" + y))));
  }
  function dashYear() {
    const y = S.dashYear && S.years.includes(S.dashYear) ? S.dashYear : (S.years.includes(String(new Date().getFullYear())) ? String(new Date().getFullYear()) : S.years[S.years.length - 1]);
    S.dashYear = y; return y;
  }
  // group rows into buckets -> [{label, counts}]
  function bucketize(rows, keyFn) {
    const map = new Map();
    rows.forEach((r) => keyFn(r).forEach((k) => {
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(r);
    }));
    return [...map.entries()].map(([label, rs]) => ({ label, c: counts(rs) }));
  }
  function monthsOf(r, y) {
    const out = new Set();
    String(r.date || "").split(/\n/).forEach((d) => {
      const m = d.match(/(?:\d{1,2}\.)?(\d{1,2})\.(\d{4})/);
      if (m && m[2] === y) out.add(Number(m[1]));
    });
    return [...out];
  }
  // horizontal stacked bars (HTML) – one row per bucket
  function hbars(buckets, opts = {}) {
    const max = Math.max(1, ...buckets.map((b) => b.c.total));
    return `<div class="hb">${buckets.map((b) => {
      const pct = b.c.total ? Math.round((b.c["הסתיים"] / b.c.total) * 100) : 0;
      return `<div class="hb-row">
        <div class="hb-label" title="${esc(b.label)}">${esc(opts.labelFn ? opts.labelFn(b) : b.label)}</div>
        <div class="hb-track"><div class="hb-bar" style="width:${(b.c.total / max) * 100}%">
          ${ST_ORDER.filter((s) => b.c[s]).map((s) => `<i class="seg" style="flex:${b.c[s]};background:${stColor[s]}" data-tip="${esc(b.label)}|${s}|${b.c[s]}|${b.c.total}"></i>`).join("")}
        </div><span class="hb-val">${b.c["הסתיים"]}/${b.c.total}${opts.pct ? ` · ${pct}%` : ""}</span></div>
      </div>`;
    }).join("")}</div>`;
  }
  // vertical stacked columns by month (SVG)
  function monthColumns(rows, y) {
    const data = MONTHS_HE.map((name, i) => ({ name, c: counts(rows.filter((r) => monthsOf(r, y).includes(i + 1))) }));
    const max = Math.max(1, ...data.map((d) => d.c.total));
    const step = max <= 5 ? 1 : max <= 10 ? 2 : 5;
    const top = Math.ceil(max / step) * step;
    const W = 720, H = 260, padL = 34, padB = 28, padT = 14, cw = (W - padL - 8) / 12, bw = Math.min(24, cw * 0.55);
    const yv = (v) => padT + (H - padT - padB) * (1 - v / top);
    let g = "";
    for (let v = 0; v <= top; v += step) g += `<line x1="${padL}" x2="${W - 4}" y1="${yv(v)}" y2="${yv(v)}" stroke="#E7E9F1" stroke-width="1"/><text x="${padL - 8}" y="${yv(v) + 4}" text-anchor="end" class="ax">${v}</text>`;
    // RTL: January on the right
    data.forEach((d, i) => {
      const cx = W - 8 - cw * i - cw / 2;
      let yTop = yv(0);
      const segs = ST_ORDER.filter((s) => d.c[s]);
      segs.forEach((s, j) => {
        const h = yv(0) - yv(d.c[s]);
        const y0 = yTop - h, isTop = j === segs.length - 1;
        const gap = j > 0 ? 2 : 0;
        const hh = Math.max(1, h - gap);
        g += isTop
          ? `<path d="M${cx - bw / 2},${y0 + hh} v${-(hh - 4)} q0,-4 4,-4 h${bw - 8} q4,0 4,4 v${hh - 4} z" fill="${stColor[s]}" class="seg" data-tip="${d.name} ${y}|${s}|${d.c[s]}|${d.c.total}"/>`
          : `<rect x="${cx - bw / 2}" y="${y0}" width="${bw}" height="${hh}" fill="${stColor[s]}" class="seg" data-tip="${d.name} ${y}|${s}|${d.c[s]}|${d.c.total}"/>`;
        yTop = y0;
      });
      if (d.c.total) g += `<text x="${cx}" y="${yTop - 6}" text-anchor="middle" class="cap">${d.c.total}</text>`;
      g += `<text x="${cx}" y="${H - 8}" text-anchor="middle" class="ax">${d.name}</text>`;
    });
    const undated = rows.filter((r) => !monthsOf(r, y).length).length;
    return { svg: `<svg viewBox="0 0 ${W} ${H}" class="cols" role="img" aria-label="משימות לפי חודש מתוכנן">${g}</svg>`, undated, data };
  }
  function legendHtml(c) {
    return `<div class="legend">${ST_ORDER.filter((s) => s !== "בוטל" || (c && c[s])).map((s) => `<span style="--c:${stColor[s]}">${s}</span>`).join("")}</div>`;
  }
  function tableOf(buckets, head) {
    return `<table class="simple dtable"><thead><tr><th>${head}</th>${ST_ORDER.map((s) => `<th>${s}</th>`).join("")}<th>סה״כ</th></tr></thead><tbody>${buckets.map((b) => `<tr><td>${esc(b.label)}</td>${ST_ORDER.map((s) => `<td>${b.c[s] || 0}</td>`).join("")}<td><b>${b.c.total}</b></td></tr>`).join("")}</tbody></table>`;
  }
  function chartCard(id, title, sub, chart, table) {
    return `<div class="panel dcard" id="${id}"><div class="dcard-head"><div><h2>${title}</h2>${sub ? `<p class="hint">${sub}</p>` : ""}</div>
      <button class="btn ghost sm" data-tbl="${id}">הצגה כטבלה</button></div>
      <div class="dchart">${chart}</div><div class="dtbl hidden">${table}</div></div>`;
  }
  function bindTips(root) {
    let tip = document.getElementById("dtip");
    if (!tip) { tip = document.createElement("div"); tip.id = "dtip"; document.body.appendChild(tip); }
    root.addEventListener("mousemove", (e) => {
      const mt = e.target.closest("[data-mtip]");
      const t = mt || e.target.closest("[data-tip]");
      if (!t) { tip.style.opacity = 0; return; }
      if (mt) {
        const [yy, lbl, v, color] = mt.dataset.mtip.split("|");
        tip.innerHTML = `<div class="tt-l">${esc(yy)}</div><div class="tt-r"><span class="sw" style="background:${color}"></span>${esc(lbl)} <b>${shekel(Number(v))}</b></div>`;
      } else {
        const [lbl, st, n, tot] = t.dataset.tip.split("|");
        tip.innerHTML = `<div class="tt-l">${esc(lbl)}</div><div class="tt-r"><span class="sw" style="background:${stColor[st]}"></span>${esc(st)} <b>${n}</b> <span class="muted">מתוך ${tot}</span></div>`;
      }
      tip.style.opacity = 1;
      const x = Math.min(window.innerWidth - tip.offsetWidth - 10, e.clientX + 14);
      tip.style.left = Math.max(10, x) + "px"; tip.style.top = (e.clientY + 16) + "px";
    });
    root.addEventListener("mouseleave", () => (tip.style.opacity = 0));
  }

  async function renderDash(m) {
    m.onclick = null; m.onchange = null;
    m.innerHTML = `<div class="loading">טוען דשבורד…</div>`;
    try { await ensureDocs(S.years); } catch (e) { m.innerHTML = `<div class="loading">${esc(e.message)}</div>`; return; }
    const y = dashYear();
    const doc = S.docs[y];
    const c = counts(doc.rows);
    const pct = c.total ? Math.round((c["הסתיים"] / c.total) * 100) : 0;
    const inc = doc.rows.reduce((a, r) => a + (num(r.income) || 0), 0);
    const secB = doc.sections.map((s, i) => ({ label: s.title.trim(), short: `${i + 1}. ${s.title.trim()}`, c: counts(doc.rows.filter((r) => r.sectionId === s.id)) }));
    const ownB = bucketize(doc.rows, (r) => { const o = String(r.owner || "").split(/[,،\n]/).map((x) => x.trim()).filter(Boolean); return o.length ? o : ["ללא אחראי"]; }).sort((a, b) => b.c.total - a.c.total);
    const priB = bucketize(doc.rows, (r) => [r.priority ? "קדימות " + r.priority : "ללא קדימות"]).sort((a, b) => a.label.localeCompare(b.label, "he", { numeric: true }));
    const mc = monthColumns(doc.rows, y);
    const prevY = S.years[S.years.indexOf(y) - 1];
    let delta = "";
    if (prevY) {
      const pc = counts(S.docs[prevY].rows); const pp = pc.total ? Math.round((pc["הסתיים"] / pc.total) * 100) : 0;
      delta = `<div class="delta">${pct - pp >= 0 ? "▲" : "▼"} ${Math.abs(pct - pp)} נק׳ לעומת ${prevY} (${pp}%)</div>`;
    }
    m.innerHTML = `
      <div class="dash-top">
        <div class="yearchips" role="tablist" aria-label="בחירת שנה">${S.years.map((yy) => `<button role="tab" class="chip ${yy === y ? "on" : ""}" data-dy="${yy}">${yy}</button>`).join("")}</div>
        <span class="spacer"></span>
        <button class="btn accent" id="presentBtn">▶ מצב הצגה</button>
      </div>
      <div class="hero-row">
        <div class="kpi hero"><div class="lbl">השלמת התוכנית ${y}</div><div class="hero-num">${pct}%</div>${delta}${stackBar(c)}${legendHtml(c)}</div>
        <div class="kpi"><div class="lbl">משימות</div><div class="val">${c.total}</div></div>
        <div class="kpi"><div class="lbl">הסתיים</div><div class="val">${c["הסתיים"]}</div></div>
        <div class="kpi"><div class="lbl">בעבודה</div><div class="val">${c["בעבודה"]}</div></div>
        <div class="kpi"><div class="lbl">לא החל / הועבר</div><div class="val">${c["לא החל"]} <small>/</small> ${c["הועבר לשנה אחרי"]}</div></div>
      </div>
      <div class="money-head"><h2>סיכום כספי ${esc(y)}${moneyPrioNote()}</h2>${moneyPrioSelect()}</div>
      ${moneyCards(moneyTotals(moneyRows(y)), y, prevY ? moneyTotals(moneyRows(prevY)) : null, prevY)}
      ${(() => { const mc2 = moneyChart(S.years, y); return chartCard("ch-money", "תקציב, הוצאה והכנסה לפי שנה", `השוואה בין כל השנים · השנה הנבחרת (${y}) מודגשת${moneyPrioNote()}`, mc2.svg, mc2.table); })()}
      <div class="panel" id="moneyTree"><h2>פירוט כספי לפי סעיף, משימה ופירוט משימה · ${esc(y)}${moneyPrioNote()}</h2>
        <p class="hint">לוחצים על ◂ כדי לפתוח סעיף למשימות, ומשימה לפירוט שלה. לחיצה על שורת פירוט פותחת את המשימה לעריכה.</p>
        <div id="treeBox">${moneyTree(y)}</div></div>
      ${chartCard("ch-sec", "התקדמות לפי סעיפים", `הושלמו מתוך כלל המשימות בכל סעיף · ${y}`, hbars(secB.map((b) => ({ ...b, label: b.short })), { pct: true }) + legendHtml(c), tableOf(secB.map((b) => ({ ...b, label: b.short })), "סעיף"))}
      <div class="dgrid">
        ${chartCard("ch-month", "פריסה לפי חודש מתוכנן", `${mc.undated ? `${mc.undated} משימות ללא תאריך מתוכנן ב-${y} לא מוצגות` : "כל המשימות מתוזמנות"}`, mc.svg + legendHtml(c), tableOf(mc.data.map((d) => ({ label: d.name, c: d.c })), "חודש"))}
        ${chartCard("ch-owner", "עומס לפי אחראי", "משימה עם כמה אחראים נספרת אצל כל אחד מהם", hbars(ownB) + legendHtml(c), tableOf(ownB, "אחראי"))}
      </div>
      ${chartCard("ch-prio", "התקדמות לפי קדימות", "", hbars(priB, { pct: true }) + legendHtml(c), tableOf(priB, "קדימות"))}`;
    bindTips(m);
    m.onclick = (e) => {
      const dy = e.target.dataset.dy; if (dy) { S.dashYear = dy; return renderDash(m); }
      const tb = e.target.dataset.tbl;
      if (tb) { const card = document.getElementById(tb); const on = card.querySelector(".dtbl").classList.toggle("hidden"); card.querySelector(".dchart").classList.toggle("hidden", !on); e.target.textContent = on ? "הצגה כטבלה" : "הצגה כגרף"; }
      if (e.target.id === "presentBtn") openPresentation(y);
    };
    m.onchange = (e) => { if (e.target.matches("[data-mprio]")) { S.moneyPrio = e.target.value; store.set("itcb_mprio", S.moneyPrio); renderDash(m); } };
    const tb = document.getElementById("treeBox");
    const rerenderTree = () => { tb.innerHTML = moneyTree(y); bindTree(tb, y, rerenderTree); };
    bindTree(tb, y, rerenderTree);
  }

  // ---------- presentation ----------
  function buildSlides(y) {
    const doc = S.docs[y];
    const c = counts(doc.rows);
    const pct = c.total ? Math.round((c["הסתיים"] / c.total) * 100) : 0;
    const slides = [];
    slides.push(`<div class="sl-cover"><img src="/logo.png" alt="ITCB"><h1>תוכנית שיווק ושימור שותפים ${y}</h1>
      <p>סטטוס נכון ל-${new Date().toLocaleDateString("he-IL")}</p></div>`);
    slides.push(`<h2 class="sl-title">תמונת מצב ${y}</h2>
      <div class="sl-hero"><div><div class="sl-big">${pct}%</div><div class="sl-cap">מהמשימות הושלמו</div></div>
        <div class="sl-nums">${ST_ORDER.filter((s) => c[s] || s !== "בוטל").map((s) => `<div><span class="sw" style="background:${stColor[s]}"></span><b>${c[s] || 0}</b> ${s}</div>`).join("")}<div class="muted">סה״כ ${c.total} משימות</div></div></div>
      <div class="sl-bar">${stackBar(c)}</div>`);
    const secB = doc.sections.map((s, i) => ({ label: `${i + 1}. ${s.title.trim()}`, c: counts(doc.rows.filter((r) => r.sectionId === s.id)) }));
    slides.push(`<h2 class="sl-title">התקדמות לפי סעיפים</h2>${hbars(secB, { pct: true })}${legendHtml(c)}`);
    doc.sections.forEach((s, i) => {
      const rows = doc.rows.filter((r) => r.sectionId === s.id);
      const sc = counts(rows);
      const goals = String(s.detail || "").split(/\n+/).map((x) => x.trim()).filter((x) => x && x !== s.title.trim() && x !== "יעדים").slice(0, 4);
      slides.push(`<div class="sl-sec-head"><span class="sec-num">${i + 1}</span><h2 class="sl-title" style="margin:0">${esc(s.title.trim())}</h2>
          <span class="sl-sec-stat">${sc["הסתיים"]}/${sc.total} הושלמו</span></div>
        ${goals.length ? `<ul class="sl-goals">${goals.map((g) => `<li>${esc(g)}</li>`).join("")}</ul>` : ""}
        <table class="sl-tbl"><thead><tr><th>משימה</th><th>אחראי</th><th>תאריך</th><th>סטטוס</th></tr></thead><tbody>
        ${rows.slice(0, 12).map((r) => `<tr><td><b>${esc(r.task)}</b>${r.taskDetail && r.taskDetail !== r.task ? ` · <span class="muted">${esc(r.taskDetail.split("\n")[0])}</span>` : ""}</td><td class="nowrap">${esc(r.owner)}</td><td class="nowrap">${esc(String(r.date || "").split("\n")[0])}</td><td><span class="pill ${stClass(r.status)}">${esc(r.status || "—")}</span></td></tr>`).join("")}
        </tbody></table>${rows.length > 12 ? `<div class="muted" style="margin-top:6px">ועוד ${rows.length - 12} משימות</div>` : ""}`);
    });
    const upcoming = doc.rows.filter((r) => r.status !== "הסתיים" && r.status !== "בוטל").sort((a, b) => dateKey(a.date) - dateKey(b.date)).slice(0, 10);
    slides.push(`<h2 class="sl-title">משימות פתוחות קרובות</h2>
      <table class="sl-tbl"><thead><tr><th>תאריך</th><th>משימה</th><th>אחראי</th><th>סטטוס</th></tr></thead><tbody>
      ${upcoming.map((r) => `<tr><td class="nowrap">${esc(String(r.date || "—").split("\n")[0])}</td><td><b>${esc(r.task)}</b>${r.taskDetail && r.taskDetail !== r.task ? ` · <span class="muted">${esc(r.taskDetail.split("\n")[0])}</span>` : ""}</td><td class="nowrap">${esc(r.owner)}</td><td><span class="pill ${stClass(r.status)}">${esc(r.status)}</span></td></tr>`).join("")}
      </tbody></table>`);
    slides.push(`<div class="sl-cover"><img src="/logo.png" alt="ITCB"><h1>תודה</h1><p>שאלות ועדכונים</p></div>`);
    return slides;
  }
  function openPresentation(y) {
    const tipEl = document.getElementById("dtip"); if (tipEl) tipEl.remove();
    let idx = 0, slides = buildSlides(y);
    const ov = document.createElement("div");
    ov.className = "present";
    document.body.appendChild(ov);
    const draw = () => {
      ov.innerHTML = `<div class="pr-bar">
          <select class="input pr-year" aria-label="שנה">${S.years.map((yy) => `<option ${yy === y ? "selected" : ""}>${yy}</option>`).join("")}</select>
          <span class="spacer"></span>
          <button class="btn sm" data-p="prev" ${idx === 0 ? "disabled" : ""}>→ הקודם</button>
          <span class="pr-count">${idx + 1} / ${slides.length}</span>
          <button class="btn sm primary" data-p="next" ${idx === slides.length - 1 ? "disabled" : ""}>הבא ←</button>
          <button class="btn sm" data-p="full">מסך מלא</button>
          <button class="btn sm" data-p="close">סגירה ✕</button></div>
        <div class="slide-wrap"><div class="slide">${slides[idx]}<img class="sl-logo" src="/logo.png" alt=""></div></div>
        <div class="pr-dots">${slides.map((_, i) => `<i class="${i === idx ? "on" : ""}" data-go="${i}"></i>`).join("")}</div>`;
      bindTips(ov.querySelector(".slide"));
    };
    const close = () => { document.removeEventListener("keydown", key); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); ov.remove(); };
    const key = (e) => {
      if (e.target.tagName === "SELECT") return;
      if (e.key === "ArrowLeft" || e.key === " " || e.key === "PageDown") { idx = Math.min(slides.length - 1, idx + 1); draw(); e.preventDefault(); }
      if (e.key === "ArrowRight" || e.key === "PageUp") { idx = Math.max(0, idx - 1); draw(); e.preventDefault(); }
      if (e.key === "Escape" && !document.fullscreenElement) close();
    };
    document.addEventListener("keydown", key);
    ov.onclick = (e) => {
      const p = e.target.dataset.p, g = e.target.dataset.go;
      if (g !== undefined) { idx = Number(g); draw(); }
      if (p === "next") { idx++; draw(); }
      if (p === "prev") { idx--; draw(); }
      if (p === "close") close();
      if (p === "full") { if (document.fullscreenElement) document.exitFullscreen(); else ov.requestFullscreen?.().catch(() => toast("הדפדפן לא מאפשר מסך מלא כאן", true)); }
    };
    ov.onchange = (e) => { if (e.target.classList.contains("pr-year")) { y = e.target.value; slides = buildSlides(y); idx = Math.min(idx, slides.length - 1); draw(); } };
    draw();
  }

  // =====================================================================
  // Gantt (v1.5) – calendar year, RTL: January on the right
  // =====================================================================
  const MONTHS_FULL = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];
  const dayOfYear = (d) => Math.floor((d - new Date(d.getFullYear(), 0, 1)) / 864e5);
  const daysIn = (y) => ((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 366 : 365);
  const isoDate = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ""); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
  // -> [{s: startDayIndex, e: endDayIndex(inclusive), kind: "range"|"month"|"day", label}]
  function intervalsFor(r, y) {
    const Y = Number(y), N = daysIn(Y), out = [];
    const sd = isoDate(r.startDate), ed = isoDate(r.endDate);
    if (sd || ed) {
      const a = sd || ed, b = ed || sd;
      if (b.getFullYear() < Y || a.getFullYear() > Y) return out;
      const s = a.getFullYear() < Y ? 0 : dayOfYear(a);
      const e = b.getFullYear() > Y ? N - 1 : dayOfYear(b);
      out.push({ s, e, kind: a === b ? "day" : "range", label: `${a.toLocaleDateString("he-IL")}${a !== b ? " – " + b.toLocaleDateString("he-IL") : ""}` });
      return out;
    }
    String(r.date || "").split(/\n|,|\s{2,}/).forEach((part) => {
      const t = part.trim();
      let m = t.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
      if (m && m[3] === y) { const d = new Date(Y, +m[2] - 1, +m[1]); const i = dayOfYear(d); out.push({ s: i, e: i, kind: "day", label: d.toLocaleDateString("he-IL") }); return; }
      const re = /(?:^|[^\d.])(\d{1,2})\.(\d{4})(?![\d.])/g; let mm;
      while ((mm = re.exec(" " + t))) {
        if (mm[2] !== y) continue;
        const mo = +mm[1] - 1; if (mo < 0 || mo > 11) continue;
        const s = dayOfYear(new Date(Y, mo, 1)), e = dayOfYear(new Date(Y, mo + 1, 0));
        out.push({ s, e, kind: "month", label: `${MONTHS_FULL[mo]} ${y}` });
      }
    });
    // merge consecutive months into one bar
    out.sort((a, b) => a.s - b.s);
    const merged = [];
    out.forEach((iv) => {
      const last = merged[merged.length - 1];
      if (last && last.kind === "month" && iv.kind === "month" && iv.s <= last.e + 1) { last.e = iv.e; last.label = last.label.split(" ")[0] + " – " + iv.label; }
      else merged.push({ ...iv });
    });
    return merged;
  }

  async function renderGantt(m) {
    m.onclick = null; m.onchange = null;
    const y = S.ganttYear && S.years.includes(S.ganttYear) ? S.ganttYear : dashYear();
    S.ganttYear = y;
    if (!S.docs[y]) { m.innerHTML = `<div class="loading">טוען…</div>`; try { await ensureDocs([y]); } catch (e) { m.innerHTML = `<div class="loading">${esc(e.message)}</div>`; return; } }
    const doc = S.docs[y];
    if (S.ganttSection && !doc.sections.some((s) => s.id === S.ganttSection)) S.ganttSection = "";
    const N = daysIn(Number(y));
    const pctR = (d) => (d / N) * 100;
    const monthStarts = MONTHS_FULL.map((_, i) => dayOfYear(new Date(Number(y), i, 1)));
    const today = new Date();
    const todayIdx = String(today.getFullYear()) === y ? dayOfYear(today) : -1;
    const grid = monthStarts.map((s, i) => `<i class="g-mline ${i % 2 ? "alt" : ""}" style="right:${pctR(s)}%;width:${pctR((monthStarts[i + 1] ?? N) - s)}%"></i>`).join("");
    const todayLine = todayIdx >= 0 ? `<i class="g-today" style="right:${pctR(todayIdx + 0.5)}%"></i>` : "";

    let body = "", undated = [], shown = 0;
    doc.sections.forEach((sec, si) => {
      if (S.ganttSection && sec.id !== S.ganttSection) return;
      const rows = doc.rows.filter((r) => r.sectionId === sec.id && (!S.ganttStatus || r.status === S.ganttStatus));
      const withIv = rows.map((r) => ({ r, iv: intervalsFor(r, y) }));
      withIv.filter((x) => !x.iv.length).forEach((x) => undated.push({ r: x.r, si }));
      const dated = withIv.filter((x) => x.iv.length);
      if (!dated.length) return;
      body += `<div class="g-row g-sec"><div class="g-label"><span class="sec-num">${si + 1}</span>${esc(sec.title.trim())}</div><div class="g-time">${grid}${todayLine}</div></div>`;
      dated.forEach(({ r, iv }) => {
        shown++;
        const name = r.task && r.taskDetail && r.taskDetail !== r.task ? `${r.task} · ${r.taskDetail.split("\n")[0]}` : (r.taskDetail || r.task || "").split("\n")[0];
        body += `<div class="g-row" data-id="${esc(r.id)}"><div class="g-label" title="${esc(name)}"><span class="g-dot" style="background:${stColor[r.status] || "#999"}"></span><span class="g-name">${esc(name)}</span><span class="g-owner">${esc(r.owner)}</span></div>
          <div class="g-time">${grid}${todayLine}${iv.map((v) => {
            const w = Math.max(pctR(v.e - v.s + 1), 0.9);
            return `<button class="g-bar ${v.kind === "day" ? "day" : ""}" style="right:${pctR(v.s)}%;width:${w}%;--c:${stColor[r.status] || "#999"}" data-id="${esc(r.id)}"
              data-gtip="${esc(name)}|${esc(v.label)}|${esc(r.status || "")}|${esc(r.owner || "")}" aria-label="${esc(name)}: ${esc(v.label)}"></button>`;
          }).join("")}</div></div>`;
      });
    });

    m.innerHTML = `
      <div class="dash-top">
        <div class="yearchips" role="tablist" aria-label="בחירת שנה">${S.years.map((yy) => `<button role="tab" class="chip ${yy === y ? "on" : ""}" data-gy="${yy}">${yy}</button>`).join("")}</div>
        <select class="input" id="gSec" style="width:auto;max-width:380px" aria-label="סעיף"><option value="">כל הסעיפים</option>${doc.sections.map((s, i) => `<option value="${s.id}" ${S.ganttSection === s.id ? "selected" : ""}>${i + 1}. ${esc(s.title.trim().slice(0, 70))}</option>`).join("")}</select>
        <select class="input" id="gSt" style="width:auto" aria-label="סטטוס"><option value="">כל הסטטוסים</option>${STATUSES.map((s) => `<option ${S.ganttStatus === s ? "selected" : ""}>${s}</option>`).join("")}</select>
        <span class="spacer"></span>
        ${legendHtml(counts(doc.rows))}
      </div>
      <div class="panel gantt-panel">
        <div class="gantt">
          <div class="g-row g-head"><div class="g-label">משימה <span class="muted" style="font-weight:500">· ${shown} מוצגות</span></div>
            <div class="g-time">${MONTHS_FULL.map((mn, i) => `<span class="g-month" style="right:${pctR(monthStarts[i])}%;width:${pctR((monthStarts[i + 1] ?? N) - monthStarts[i])}%">${mn}</span>`).join("")}
            ${todayIdx >= 0 ? `<span class="g-today-lbl" style="right:${pctR(todayIdx + 0.5)}%">היום</span>` : ""}</div></div>
          ${body || `<div class="empty">אין משימות עם תאריכים ב-${y} לפי הסינון</div>`}
        </div>
      </div>
      ${undated.length ? `<details class="panel g-undated"><summary><b>${undated.length} משימות בלי תאריך ב-${y}</b> <span class="muted">· לחיצה על משימה פותחת אותה להוספת תאריך</span></summary>
        <ul>${undated.map(({ r, si }) => `<li data-id="${esc(r.id)}"><span class="g-dot" style="background:${stColor[r.status] || "#999"}"></span><span class="muted">${si + 1}.</span> ${esc(r.task || "")}${r.taskDetail && r.taskDetail !== r.task ? ` · ${esc(r.taskDetail.split("\n")[0])}` : ""}${r.date ? ` <span class="muted">(${esc(r.date.split("\n")[0])})</span>` : ""}</li>`).join("")}</ul></details>` : ""}
      <p class="audit">כל מלבן מסמן את תקופת הביצוע. משימה עם תאריך חודשי בלבד (למשל 03.${y}) מכסה את כל החודש. כדי לקבוע טווח מדויק, פתח את המשימה והזן תחילת ביצוע וסיום ביצוע.</p>`;

    // tooltip
    let tip = document.getElementById("dtip");
    if (!tip) { tip = document.createElement("div"); tip.id = "dtip"; document.body.appendChild(tip); }
    const g = m.querySelector(".gantt");
    g.onmousemove = (e) => {
      const t = e.target.closest("[data-gtip]");
      if (!t) { tip.style.opacity = 0; return; }
      const [nm, lbl, st, ow] = t.dataset.gtip.split("|");
      tip.innerHTML = `<div class="tt-l">${esc(nm)}</div><div>${esc(lbl)}</div><div class="tt-r"><span class="sw" style="background:${stColor[st] || "#999"}"></span>${esc(st || "—")}${ow ? ` · ${esc(ow)}` : ""}</div>`;
      tip.style.opacity = 1;
      tip.style.left = Math.max(10, Math.min(window.innerWidth - tip.offsetWidth - 10, e.clientX + 14)) + "px";
      tip.style.top = e.clientY + 16 + "px";
    };
    g.onmouseleave = () => (tip.style.opacity = 0);

    m.onclick = (e) => {
      const gy = e.target.dataset.gy; if (gy) { S.ganttYear = gy; return renderGantt(m); }
      const row = e.target.closest("[data-id]");
      if (row) {
        tip.style.opacity = 0;
        openRow(y, row.dataset.id);
      }
    };
    m.onchange = (e) => {
      if (e.target.id === "gSec") { S.ganttSection = e.target.value; renderGantt(m); }
      if (e.target.id === "gSt") { S.ganttStatus = e.target.value; renderGantt(m); }
    };
  }

  // ---------- show/hide password (eye) ----------
  const EYE = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  const EYE_OFF = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.9 17.9A10.5 10.5 0 0 1 12 19C5.5 19 2 12 2 12a18 18 0 0 1 4.1-5.1M9.9 5.2A9.6 9.6 0 0 1 12 5c6.5 0 10 7 10 7a18 18 0 0 1-2.2 3.2M14.1 14.1a3 3 0 1 1-4.2-4.2M2 2l20 20"/></svg>';
  function addEyes(root = document) {
    root.querySelectorAll('input[type="password"]:not([data-eye])').forEach((inp) => {
      inp.dataset.eye = "1";
      const wrap = document.createElement("div");
      wrap.className = "pw-wrap";
      inp.parentNode.insertBefore(wrap, inp);
      wrap.appendChild(inp);
      const b = document.createElement("button");
      b.type = "button"; b.className = "pw-eye"; b.innerHTML = EYE;
      b.setAttribute("aria-label", "הצגת הסיסמה"); b.title = "הצגת הסיסמה";
      b.onclick = () => {
        const show = inp.type === "password";
        inp.type = show ? "text" : "password";
        b.innerHTML = show ? EYE_OFF : EYE;
        b.setAttribute("aria-label", show ? "הסתרת הסיסמה" : "הצגת הסיסמה"); b.title = b.getAttribute("aria-label");
        inp.focus();
      };
      wrap.appendChild(b);
    });
  }
  new MutationObserver(() => addEyes()).observe(document.body, { childList: true, subtree: true });

  boot();
})();
