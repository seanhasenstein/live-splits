# Task: Generate the Crusaders XC PDFs from app data — pixel-match the existing documents

I have a set of printed documents for the Sheboygan Lutheran Crusaders cross country program that are currently built with Python + WeasyPrint outside this app. I want this Next.js app to generate the same PDFs directly from the meet data we already store — pre-meet and post-meet — so they come out **identical** to the current ones. Our current in-app versions are close but not exact. The spec below is the source of truth; when this spec and existing app styles disagree, the spec wins.

Before writing code: read this whole spec, look at how the app currently renders these documents, and give me a short plan that lists (1) where the current output deviates from this spec, (2) the rendering approach, and (3) the data each document needs and where it comes from in our models (flag any field we don't store yet). Then build one document at a time, starting with Meet Splits, and show me a rendered PDF of each before moving on.

---

## 1. Rendering approach

- Build each document as a server-rendered HTML page (React server component or a plain HTML string) with **one shared stylesheet** (section 3), and print it to PDF with headless Chromium (Puppeteer or Playwright; on Vercel use `@sparticuz/chromium`). Options: `format: 'Letter'`, `printBackground: true`, `preferCSSPageSize: true`.
- Page: US Letter, `@page { size: letter; margin: 0.4in; }`. Post-meet docs use a fixed-height page container (below). The Meet Sheet uses its own margins (section 5).
- **Footer pinning (non-negotiable):** every footer sits at the bottom of every page regardless of content length. Use the fixed-height container pattern, which works in Chromium:
  ```css
  .page{position:relative;height:10.1in;padding-bottom:0.75in;overflow:hidden;page-break-after:always;}
  .page:last-child{page-break-after:auto;}
  .footer{position:absolute;bottom:0;left:0;right:0;}
  ```
  Each logical page is its own `.page` div; never let content flow across pages.
- Add a dev route (e.g. `/dev/pdf/[doc]?meet=…`) that renders the HTML in the browser so layout can be iterated quickly, plus the PDF endpoint.

## 2. Font (likely the main source of the mismatch)

The CSS says `'Helvetica Neue', Helvetica, Arial, sans-serif`, but the reference PDFs were actually rendered in **TeX Gyre Heros** (regular, bold, italic — embedded in the reference PDFs), because Helvetica Neue isn't installed where they're built. To match exactly and render the same on every machine and on Vercel:

- Self-host **TeX Gyre Heros** (free, GUST Font License; `texgyreheros-regular/bold/italic/bolditalic.otf`) and load it with `@font-face`. Make it the first family in the stack: `font-family: 'TeX Gyre Heros', 'Helvetica Neue', Helvetica, Arial, sans-serif;`
- The font has only two weights. CSS weights 500/600 render as regular, 700/800/900 render as **bold**. Do not load a heavier weight to "honor" 800 — that would diverge from the reference.
- Wait for fonts before printing: `await page.evaluateHandle('document.fonts.ready')`.
- Tabular numerals everywhere numbers appear: `font-variant-numeric: tabular-nums`.

## 3. Design system ("V4B Hairline / Crusader")

Colors:
```
--green:#184A23   --green-deep:#0F3318   --gold:#C99A06   --soft-gold:#E8CC91   --cream:#FAF6E9
--ink:#1A1A1A     --soft:#5A5A5A         --rule:#707070   --rule-soft:#C4C4C4   --rule-light:#D8D8D8
--ghost:#BDBDBD   tag-gray:#8A8A8A
```
Print rules: neutral grays only (no warm tans). Soft gold `#E8CC91` for marquee rules (full gold prints too dark on cream). Logo: the Crusader shield PNG with its black background removed (transparent), embedded as a data URI.

### Shared stylesheet for all post-meet documents (copy verbatim, then swap the font stack per section 2)
```css
:root{--green:#184A23;--green-deep:#0F3318;--gold:#C99A06;--soft-gold:#E8CC91;--ink:#1A1A1A;--soft:#5A5A5A;--rule:#707070;
 --rule-soft:#C4C4C4;--rule-light:#D8D8D8;--cream:#FAF6E9;--ghost:#BDBDBD;}
@page{size:letter;margin:0.4in;} *{box-sizing:border-box;}
body{margin:0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:var(--ink);font-size:9.5pt;line-height:1.3;}
.page{position:relative;height:10.1in;padding-bottom:0.75in;overflow:hidden;page-break-after:always;}
.page:last-child{page-break-after:auto;}
.hero{display:flex;align-items:center;gap:16px;padding:6px 0 10px;border-bottom:1pt solid var(--rule);}
.hero.green{border-bottom:1.2pt solid var(--green);} .hero.nobar{border-bottom:none;padding-bottom:4px;}
.hero img{width:60px;}
.eyebrow{font-size:7.5pt;letter-spacing:0.32em;color:var(--soft);text-transform:uppercase;font-weight:700;}
.eyebrow b{color:var(--gold);font-weight:700;}
h1{margin:3px 0 4px;font-size:22pt;font-weight:800;color:var(--green);letter-spacing:0.01em;line-height:1.05;}
.hero-meet{display:flex;align-items:center;flex-wrap:wrap;color:var(--soft);font-size:9.5pt;}
.hero-meet .mn{font-weight:700;color:var(--ink);}
.dv{color:var(--rule);margin:0 4px;font-weight:700;font-size:11pt;line-height:1;display:inline-flex;align-items:center;}
.sec{margin-top:16px;font-size:15pt;font-weight:800;color:var(--green);letter-spacing:0.06em;text-transform:uppercase;
 border-bottom:1px solid var(--green);padding-bottom:4px;}
table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums;}
th{font-size:6.8pt;letter-spacing:0.14em;text-transform:uppercase;color:var(--green);font-weight:700;padding:4px 5px 4px;
 text-align:right;border-bottom:1.2pt solid var(--green);}
th.l,td.l{text-align:left;}
td{padding:4px 5px 5px;border-bottom:1px solid var(--rule-light);text-align:right;}
td.name{font-weight:700;text-align:left;}
.star{color:var(--gold);font-weight:400;}
.footer{position:absolute;bottom:0;left:0;right:0;border-top:1px solid var(--rule-soft);padding-top:10px;
 display:flex;align-items:center;gap:10px;font-size:7.5pt;color:var(--soft);}
.footer img{width:24px;} .footer .lg{flex:1;} .footer .lg b{color:var(--ink);font-weight:700;}
.footer .rt{text-align:right;letter-spacing:0.14em;text-transform:uppercase;font-size:7.5pt;}
/* Meet Splits stat block */
.stats{display:flex;align-items:flex-end;gap:28px;margin-top:9px;}
.st .n{font-size:21pt;font-weight:800;color:var(--green);line-height:1;}
.st .l{font-size:7pt;letter-spacing:0.22em;color:var(--soft);text-transform:uppercase;margin-top:5px;}
.st.gold .n{color:var(--gold);font-size:17pt;}
.st.note{font-size:7.5pt;letter-spacing:0.12em;color:var(--soft);font-weight:700;text-transform:uppercase;padding-bottom:12px;max-width:2.7in;line-height:1.35;}
table.sp{margin-top:8px;} table.sp td{padding:5px 5px 6px;}
td.fin{font-weight:700;} td.plc{color:var(--soft);}
.lp{display:inline-block;background:var(--green);color:#fff;font-size:5.6pt;font-weight:800;letter-spacing:0.16em;
 padding:2.5px 6px 2.5px 7px;border-radius:2px;line-height:1;}
.dnr-h{margin-top:16px;font-size:7pt;letter-spacing:0.2em;color:var(--green);font-weight:800;text-transform:uppercase;
 border-bottom:1.2pt solid var(--green);padding-bottom:4px;}
/* Highlights */
.statbar{display:flex;border-top:1px solid var(--rule);border-bottom:1px solid var(--rule);margin-top:8px;padding:6px 0 5px;}
.statbar .c{flex:1;text-align:center;border-left:1px solid var(--rule-soft);}
.statbar .c:first-child{border-left:none;}
.statbar .n{font-size:24pt;font-weight:800;color:var(--green);line-height:1.05;}
.statbar .l{font-size:6.8pt;letter-spacing:0.22em;color:var(--soft);font-weight:700;text-transform:uppercase;margin-top:2px;}
.th-row{display:flex;justify-content:space-between;align-items:baseline;margin-top:10px;border-bottom:1px solid var(--green);padding-bottom:4px;}
.th-row .tt{font-size:15pt;font-weight:800;color:var(--green);letter-spacing:0.06em;}
.th-row .tm{font-size:6.8pt;letter-spacing:0.22em;color:var(--soft);font-weight:700;text-transform:uppercase;}
.th-row .tm b{color:var(--green);font-size:10.5pt;letter-spacing:0.02em;margin-right:5px;}
.th-row .tm .dot{color:var(--soft);margin:0 9px;}
table.hl td{padding:2.2px 5px 3px;} .roomy table.hl td{padding:4px 5px 5px;} .roomy .blurb{font-size:9pt;line-height:1.5;margin-top:9px;} .roomy .th-row{margin-top:16px;}
table.hl td.tm{padding-left:16px;text-align:left;font-weight:700;white-space:nowrap;} table.hl td.tm.sb{color:var(--green);}
table.hl td.prev{text-align:left;white-space:nowrap;}
.mtag{font-size:6.2pt;letter-spacing:0.14em;color:#8A8A8A;font-weight:700;margin-left:5px;}
.jv{font-size:6.2pt;letter-spacing:0.08em;color:#8A8A8A;margin-left:2px;}
td.chg{color:var(--green);font-weight:800;text-align:right;} td.rk{color:var(--green);font-weight:800;}
td.hon{font-size:6.8pt;letter-spacing:0.1em;text-transform:uppercase;font-weight:800;white-space:nowrap;}
td.hon.h1,td.hon.h2{color:var(--green);} td.hon.h3{color:#8A8A8A;}
td.dash{color:var(--rule-soft);}
/* PR/SB badges — PR green, SB gold (matches the live-splits app) */
.sbp{display:inline-block;background:var(--gold);color:#fff;font-size:5.8pt;font-weight:800;letter-spacing:0.06em;
 padding:2px 3px 2.5px;border-radius:2px;line-height:1;margin-left:4px;vertical-align:1px;}
.sbp.prp{background:var(--green);}
.blurb{margin-top:6px;font-size:8.5pt;line-height:1.4;padding-bottom:8px;}
.blurb b{color:var(--green);}
.blurb.last{border-bottom:1px solid var(--rule);}
.nextup{position:absolute;left:0;right:0;bottom:0.72in;text-align:center;}
.nextup img{width:28px;} .nextup .lbl{font-size:7pt;letter-spacing:0.3em;color:var(--soft);font-weight:700;margin-top:4px;}
.nextup .nm{font-size:19pt;font-weight:800;color:var(--green);line-height:1.15;}
.nextup .wh{font-size:9pt;color:var(--soft);letter-spacing:0.03em;}
/* All-Conference marquee — ONLY for All-Conference honors, never reused for other callouts */
.marquee{margin-top:12px;border-top:1.5pt solid var(--soft-gold);border-bottom:1.5pt solid var(--soft-gold);background:var(--cream);padding:8px 0 9px;text-align:center;}
.mq-eb{font-size:7pt;letter-spacing:0.28em;text-transform:uppercase;color:var(--soft);font-weight:800;margin-bottom:5px;}
.mq{width:100%;table-layout:fixed;} .mq td{border:none;text-align:center;padding:0 4px;vertical-align:top;}
.mq-n{font-size:18pt;font-weight:800;color:var(--green);line-height:1.1;}
.mq-y{font-size:8pt;color:var(--soft);margin-top:2px;letter-spacing:0.04em;} .mq-y b{color:var(--gold);font-weight:800;letter-spacing:0.12em;text-transform:uppercase;font-size:7.4pt;}
.mq-hm{margin-top:8px;padding-top:6px;border-top:1px solid var(--soft-gold);margin-left:12%;margin-right:12%;}
.mq-hm .t{font-size:6.8pt;letter-spacing:0.24em;text-transform:uppercase;font-weight:800;color:var(--soft);margin-bottom:2px;}
.mq-hm .ns{font-size:10.5pt;font-weight:800;color:var(--green);} .mq-hm .ns .p{font-size:8pt;font-weight:400;color:var(--soft);} .mq-hm .ns .sep{color:var(--soft-gold);margin:0 7px;font-weight:400;}
/* Course Top 30 */
.cols{display:flex;gap:30px;margin-top:14px;} .col{flex:1;}
.col .ch{font-size:9.5pt;font-weight:800;color:var(--green);letter-spacing:0.22em;border-bottom:1px solid var(--green);padding-bottom:4px;}
table.t30 td{padding:3.4px 5px 4.2px;font-size:9.6pt;border-bottom:1px solid #ECECEC;}
table.t30 td.rk{color:var(--gold);font-weight:800;width:26px;}
table.t30 td.yr{color:var(--soft);font-size:8.4pt;width:34px;text-align:left;padding-left:2px;}
table.t30 td.nm{text-align:left;font-weight:700;} table.t30 td.tt{font-weight:800;color:var(--green-deep);}
tr.new td{background:var(--cream);} tr.new td.nm{color:var(--green);}
tr.new td.rk{background:linear-gradient(to right,var(--gold) 0,var(--gold) 3px,var(--cream) 3px);}
.footer .brand{flex:1;letter-spacing:0.22em;font-weight:700;font-size:7.5pt;}
.footer .rt2{text-align:right;font-size:8pt;line-height:1.5;} .footer .rt2 b{color:var(--green);}
/* Season Times grid */
table.grid{margin-top:6px;} table.grid th{font-size:6.3pt;letter-spacing:0.1em;padding:5px 3px;white-space:nowrap;color:var(--soft);border-bottom:1px solid var(--rule);}
table.grid th.ghost{color:var(--ghost);}
table.grid td{padding:5px 3px 6px;font-size:9.2pt;} table.grid td.name{white-space:nowrap;}
table.grid tr.g3 td{border-bottom:1px solid var(--rule);}
td.let span{text-decoration:underline;text-decoration-thickness:0.8px;text-underline-offset:2px;}
td.best span{color:var(--green);font-weight:800;}
```

### Shared hero (every document)
```html
<div class="hero">  <!-- add " nobar" on Highlights, " green" on Top 30 -->
  <img src="data:image/png;base64,{LOGO}">
  <div>
    <div class="eyebrow">Sheboygan Lutheran Crusaders · <b>Cross Country</b></div>
    <h1>{TITLE}</h1>
    <div class="hero-meet"><span class="mn">{Meet name}</span><span class="dv">•</span>{part 2}<span class="dv">•</span>{part 3}</div>
  </div>
</div>
```
Hero dividers are the bullet `•` (U+2022), never the middle dot `·` — middle dots print too faint. Titles are uppercase: MEET SPLITS, MEET HIGHLIGHTS, SEASON TIMES, MEET SHEET, `<COURSE> TOP 30`.

### Footer (post-meet)
```html
<div class="footer"><img src="data:image/png;base64,{LOGO}"><div class="lg">{legend}</div><div class="rt">{right text}</div></div>
```

## 4. Post-meet documents

All are built from the meet's results once the meet is complete. Two pages (boys p.1, girls p.2) unless noted.

### 4a. Meet Splits
- Hero: `MEET SPLITS` · line = meet name • date • weather (weather omits dew point, e.g. "52°, sunny, southwest wind 12 mph, 44% humidity").
- One gender per page. Sections: `.sec` "Boys Varsity", stats block, table; `.sec` "Boys JV", stats block, table; then DNRs.
- Stats block (`.stats`): varsity = Pts · Place (ordinal) · Teams · Runners, then a gold `.st.gold` cell "`{place} · {time}`" labeled "Letter Standard". JV = Pts · Place · Teams only — no letter standard, no field size. If the race has no team score, render no stats block at all. Optional `.st.note` for a one-line note (e.g. tiebreak, "Small School Division").
- Table `table.sp` with `<colgroup>`: Athlete 27%, five auto columns, Letter 13%. Headers: Athlete | Mile 1 | Mile 2 | Mile 3.1 | Finish | Place | Letter.
- Cells: Mile 1/2/3.1 are **splits** (computed from cumulative clock times), Finish is bold with the PR/SB badge inline right after the time; when there's no badge render a hidden one (`<span class="sbp" style="visibility:hidden">PR</span>`) so the times stay aligned. Place is an ordinal in soft ink. Letter column shows the green `LETTER` pill (`.lp`) for letter-point earners.
- DNRs: `.dnr-h` "Did Not Run", then a `table.sp` (margin-top:0) of name-only rows with blank cells.
- Footer legend: `[SB] season best · [PR] career best (high school) · **Letter** finish at or under the varsity letter standard`; right: `{MEET NAME} · {DATE}`.
- Combined boys/girls race meets: drop the race-label eyebrow and use one stats header per page. Division meets (large/small school): show only our division; our rows get cream background + bold green text, no gold edge bar.

### 4b. Meet Highlights
- Hero with `nobar`: `MEET HIGHLIGHTS` · meet name • location • date.
- Stat bar (`.statbar`), four cells: Season Bests · Letter Points · Career Bests · `{Course} Top 30 Marks` (conference meet: All-Conference instead of the Top 30 cell).
- Conference meet only: one `.marquee` per gender with "★ All-Conference Honors ★", 1st/2nd Team names in a row (`.mq-n` name, `.mq-y` "<b>1st Team</b> (8th)"), Honorable Mention line below. 1st Team = overall places 1–10, 2nd = 11–20, HM = 21–30.
- Per gender: `.th-row` with team name left and "**N** Season Bests · **N** Career Bests · **N** {Course} Top 30" right; then `table.hl`.
- `table.hl` colgroup 30% / 10% / 13% / 19% / 10% / rest. Headers: Athlete | Place | Time (left, padding-left 16px) | Previous SB (left) | Change | `{Course} All-Time` (or "All-Conference").
- Rows = varsity + JV runners who ran an SB, a PR, or made the course Top 30, sorted by finish time. Place gets a small gray `JV` tag for JV runners. Time is bold, green when SB/PR, with the badge (PR wins over SB). Previous SB = time plus a gray caps meet tag (`.mtag`, e.g. KML, PARKSIDE). Change = m:ss drop (no minus, no tenths), or gold `MATCH` when equal to the second; non-SB rows show `—` in both. All-Time column = green `#N` rank on the course board, blank if off the board.
- Blurb paragraph after each table (`.blurb`, athlete names in bold green; last one gets `.last` with a bottom rule).
- NEXT UP block (`.nextup`, centered above the footer): small shield, "NEXT UP", next meet name, "location · date".
- Footer legend: `[SB] season best · [PR] career best (high school) · Previous SB is each runner's fastest 2026 mark entering this meet`.
- Layout option: one page (both genders) or split into one page per gender with the `.roomy` class on the page — support both.

### 4c. Course Top 30 (one page)
- Hero with `green` bar: `{COURSE} TOP 30` · meet/course name • "All-Time Crusader Marks" • "Updated {Month Year}".
- Two `.col` columns (BOYS / GIRLS), each a `table.t30` with rank | year | runner | time. **No column headers, no "N performances" count.**
- Entries from this season: `tr.new` (cream row, green name, 3px gold left edge drawn as a gradient inside the rank cell — not a border).
- Varsity race winners get a gold ★ (`.star`); JV winners never get a star.
- Footer: shield · "SHEBOYGAN LUTHERAN CROSS COUNTRY" (`.brand`) · right `.rt2`: "**Gold edge** new in 2026<br>UPDATED {DATE} · after the {meet}".
- A meet-specific board (e.g. the Crusader Challenge) is the top 30 of that meet only — word it as meet history, not course history.

### 4d. Season Times grid
- Hero: `SEASON TIMES` · "**2026 Season** · through the {meet} · {date}". Portrait (booklet requirement).
- `.sec` with `border-bottom:none` for BOYS/GIRLS, then `table.grid`: Athlete + one column per meet on the season schedule (short caps labels). Header row has a top rule (`border-top:1px solid var(--rule)` on each th). Meets not yet run: `th.ghost` (gray).
- Cells: underline = letter point earned (`td.let`), bold green = season best (`td.best`; every result equal to the SB is bold, so a runner can carry it across meets), blank = did not run. A heavier rule every 3rd row (`tr.g3`, not after the last).
- Footer legend: "**Underline** letter point earned · **Bold green** season best · blank = did not run"; right: "Updated {DATE}".

### Also generated post-meet (text, not PDF)
Intercom announcement script (spoken rhythm, no print formatting) and the coach email to parents. Lower priority — note them in the plan.

## 5. Pre-meet: Meet Sheet (one page, athlete/parent handout)
Different margins and slightly different hero; uses a margin-box footer in WeasyPrint — in Chromium use the fixed-height `.page` container with an absolute footer instead.
```css
@page{size:letter;margin:0.4in 0.5in 0.75in;}
body{font-size:10pt;line-height:1.5;}
.hero{padding:2px 0 10px;margin-bottom:12px;display:flex;align-items:center;gap:20px;border-bottom:1pt solid var(--rule);}
.hero-logo{flex:0 0 58px;height:66px;display:flex;align-items:center;justify-content:center;} .hero-logo img{max-width:100%;max-height:100%;}
.hero-eyebrow{font-size:7.5pt;letter-spacing:0.32em;color:var(--soft);font-weight:600;text-transform:uppercase;margin-bottom:4px;}
.hero-eyebrow .sport{color:var(--gold);font-weight:800;}
.hero h1{font-size:23pt;font-weight:800;letter-spacing:-0.02em;line-height:1;margin-bottom:5px;color:var(--green);}
.hero-meet{font-size:9.5pt;line-height:1.35;color:var(--soft);font-weight:500;letter-spacing:0.02em;}
.hero-meet .meet-name{font-weight:700;color:var(--ink);} .hero-meet .meet-divider{color:var(--rule);margin:0 8px;}
.time-bar{display:flex;padding:4px 0 13px;align-items:center;justify-content:space-around;margin-bottom:14px;border-bottom:1pt solid var(--rule);}
.time-bar .stat{text-align:center;flex:1;}
.time-bar .stat .num{font-size:20pt;font-weight:800;line-height:1;display:block;color:var(--green);font-variant-numeric:tabular-nums;}
.time-bar .stat .label{font-size:6.8pt;letter-spacing:0.2em;text-transform:uppercase;margin-top:4px;display:block;color:var(--soft);font-weight:600;}
.time-bar .divider{width:1px;height:34px;background:var(--rule);}
.callout{background:var(--cream);border-left:3pt solid var(--gold);padding:9px 14px;margin-bottom:14px;font-size:10pt;} .callout strong{color:var(--green);}
.section{margin-bottom:22px;}
.section-title{font-size:8pt;letter-spacing:0.18em;text-transform:uppercase;font-weight:800;color:var(--green);padding-bottom:4px;margin-bottom:8px;border-bottom:0.6pt solid var(--green);}
.section strong{color:var(--green);}
.section a{color:var(--green);font-weight:700;text-decoration:underline;text-decoration-color:var(--soft-gold);}
table.sched{width:100%;border-collapse:collapse;}
table.sched td{padding:2px 6px 3px 0;border-bottom:1px solid var(--rule-soft);vertical-align:top;}
table.sched td.t{font-weight:800;color:var(--green);width:60px;font-variant-numeric:tabular-nums;}
table.sched .note{color:var(--soft);} table.sched.awards td.t{width:96px;white-space:nowrap;}
ul.notes{list-style:none;} ul.notes li{padding:2px 0 3px 14px;border-bottom:1px solid var(--rule-soft);position:relative;}
ul.notes li:last-child{border-bottom:none;}
ul.notes li::before{content:'';position:absolute;left:1px;top:10px;width:5px;height:5px;background:var(--gold);}
table.teams{width:100%;border-collapse:collapse;margin-top:2px;} table.teams td{padding:1px 6px 1px 0;width:25%;vertical-align:top;}
table.teams .tag{color:var(--soft);font-size:8.5pt;}
.team-note{border-left:2pt solid var(--soft-gold);padding:1px 0 1px 12px;font-weight:700;color:var(--green);}
.footer{width:100%;border-collapse:collapse;border-top:1pt solid var(--rule);font-size:7.5pt;color:var(--soft);}
.footer td{padding-top:8px;vertical-align:middle;} .footer td.logo{width:32px;} .footer img{height:22px;} .footer .motto{font-style:italic;}
```
Structure: hero (`MEET SHEET`; line 1 = meet name · host, line 2 = location · date; eyebrow "Sheboygan Lutheran Crusaders · Cross Country" with the sport in gold) → key-times strip (`.time-bar`, e.g. Course Opens / Girls 5K / Boys 5K / Awards with 1px dividers) → optional `.callout` → hairline sections (`.section-title`): Schedule (`table.sched`), qualifying/awards, Competing Schools (4-column `table.teams`, column-major), For Fans & Families (`ul.notes` with gold square bullets) → closing `.team-note` → footer table: shield + italic motto "Accept the Challenge — the Crusader Challenge — Run Worthy" · "Cross Country Crusaders 2026". This sheet sometimes has only a time strip and no stat block; content is editable per meet, so drive it from a meet-sheet content object stored with the meet.

Pre-meet also: the course Top 30 PDF (4c, without new-entry highlights) goes out before race day.

## 6. Data rules (these matter as much as the styling)
- **Times: whole seconds only, truncated, never rounded.** 16:52.9 → 16:52. No tenths anywhere.
- Splits = differences of cumulative clock times, then truncated. Last column is labeled "Mile 3.1".
- **Season best:** fastest 2026 time *entering* this meet; a time equal to the prior SB to the second counts as a new SB (Highlights shows gold MATCH). **PR** = career high-school best entering the meet; a time ≤ that is a PR. PR outranks SB — show one badge.
- SB/PR change values render as m:ss (0:49, 2:12) — no minus sign.
- **Letter points:** cutoff place = `floor(0.66 × varsity finishers)`; the letter standard time is that runner's time. Varsity finishers at or under it earn a letter point. Display as "`{place} · {time}`".
- Course All-Time rank comes from the stored course Top 30 board after merging this meet's marks (re-sort by time, keep 30, ties: existing mark first).
- Race-winner ★: varsity winners only.
- Never mention falls or incidents; don't present a slow Mile 2 on the home course as an insight (big hill after mile 1). No training/workout suggestions in athlete-facing text.
- Canonical roster spellings come from our athlete records — don't trust names pasted from timing sites.

## 7. Verify before calling a document done
- Render the PDF and compare against the reference PDF I'll provide for the same meet, side by side at 150 DPI. Check: font is TeX Gyre Heros (run `pdffonts`), footer at the bottom of **every** page, no third page, nothing clipped (descenders in tight rows), times right-aligned in a straight column with the hidden-badge spacer working, colors exact.
- Write a small unit test for the time math: truncation, splits, SB/MATCH logic, letter cutoff (e.g. 143 varsity finishers → 94th place; 64 → 42nd).
