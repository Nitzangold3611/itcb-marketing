import openpyxl, json, sys, re
src = sys.argv[1]; out = sys.argv[2]

def fmt(v):
    if v is None: return ""
    if isinstance(v, float):
        if v.is_integer(): return str(int(v))
        return repr(v)
    return str(v).strip()

def fmt_date(v):
    if isinstance(v, float) and not v.is_integer():
        m, y = repr(v).split(".")
        if len(y) == 4: return f"{int(m):02d}.{y}"
    return fmt(v)

def load(path):
    ws = openpyxl.load_workbook(path)["גיליון1"]
    # fill-down map for merged cells in given columns
    merged = {}
    for rng in ws.merged_cells.ranges:
        top = ws.cell(rng.min_row, rng.min_col).value
        for r in range(rng.min_row, rng.max_row+1):
            for c in range(rng.min_col, rng.max_col+1):
                merged[(r,c)] = (top, r == rng.min_row)
    return ws, merged

def get(ws, merged, r, c, filldown):
    if (r,c) in merged:
        val, first = merged[(r,c)]
        return val if (filldown or first) else None
    return ws.cell(r,c).value

def build(path, cols, statuscols):
    """cols: dict field->col index (1-based). statuscols: year->col"""
    ws, merged = load(path)
    years = {y: {"sections": [], "rows": []} for y in statuscols}
    secmap = {y: {} for y in statuscols}
    for r in range(3, ws.max_row+1):
        rec = {}
        for f, c in cols.items():
            fd = f in ("section","sectionDetail","task","taskDetail")
            v = get(ws, merged, r, c, fd)
            rec[f] = fmt_date(v) if f == "date" else fmt(v)
        if not any(rec[k] for k in ("task","taskDetail","updates","owner")): continue
        for y, sc in statuscols.items():
            st = fmt(ws.cell(r, sc).value)
            if not st: continue
            secs = secmap[y]
            if rec["section"] not in secs:
                sid = f"s{len(secs)+1}"
                secs[rec["section"]] = sid
                years[y]["sections"].append({"id": sid, "title": rec["section"], "detail": rec["sectionDetail"]})
            row = {k: v for k, v in rec.items() if k not in ("section","sectionDetail")}
            row["status"] = st
            row["sectionId"] = secs[rec["section"]]
            row["id"] = f"r{y}-{r}"
            years[y]["rows"].append(row)
    return years

common = ["task","taskDetail","updates"]
c2526 = {"section":1,"sectionDetail":2,"task":3,"taskDetail":4,"updates":5,"budget":8,"owner":9,"date":10,"priority":11,"income":12,"expense":13,"notes":14}
c2027 = {"section":1,"sectionDetail":2,"task":3,"taskDetail":4,"updates":5,"budget":7,"owner":8,"date":9,"priority":10,"income":11,"expense":12,"notes":13}
data = {}
data.update(build(f"{src}/y2526.xlsx", c2526, {"2025":6, "2026":7}))
data.update(build(f"{src}/y2027.xlsx", c2027, {"2027":6}))
for y,d in data.items():
    print(y, len(d["sections"]), "sections", len(d["rows"]), "rows")
json.dump(data, open(out,"w"), ensure_ascii=False, indent=1)
