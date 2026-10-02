(function () {
  var KEY = "sched-data-v1";
  var NATIVE = typeof window.Android !== "undefined";
  var CATS = { "課程": "--c-class", "校隊": "--c-team", "作業考試": "--c-hw", "跑步": "--c-run", "英文": "--c-eng", "程式": "--c-code", "柳丁樹": "--c-tree", "閱讀": "--c-read", "讀書": "--c-study", "社團": "--c-club", "健身": "--c-gym", "其他": "--c-misc" };
  var ITEM_CATS = ["作業考試", "讀書", "跑步", "英文", "程式", "柳丁樹", "閱讀", "其他"];
  var FIXED_CATS = ["課程", "校隊", "社團", "健身"].concat(ITEM_CATS);
  var APPS = [
    { cls: "strava", name: "Strava", letter: "S", pkg: "com.strava", web: "https://www.strava.com/dashboard" },
    { cls: "epop", name: "EPOP", letter: "E", pkg: "kr.epopsoft.word", web: "https://play.google.com/store/apps/details?id=kr.epopsoft.word" },
    { cls: "claude", name: "Claude", letter: "C", pkg: "com.anthropic.claude", web: "https://claude.ai" }
  ];
  var WD = ["日", "一", "二", "三", "四", "五", "六"];
  var HOUR = 48; // px per hour on the timeline
  var data = { classes: [], tasks: [], habits: [] }, filter = "全部", viewDate = todayStr(), month = viewDate.slice(0, 7), kind = "event";

  // ---------- helpers ----------
  function pad(n) { return String(n).padStart(2, "0"); }
  function fmt(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function todayStr() { return fmt(new Date()); }
  function parse(s) { var p = s.split("-").map(Number); return new Date(p[0], p[1] - 1, p[2]); }
  function addDays(s, n) { var d = parse(s); d.setDate(d.getDate() + n); return fmt(d); }
  function label(s) { var d = parse(s); return (d.getMonth() + 1) + "/" + d.getDate() + "（" + WD[d.getDay()] + "）"; }
  function mins(t) { if (!t) return null; var p = t.split(":").map(Number); return p[0] * 60 + p[1]; }
  function hhmm(m) { m = Math.max(0, Math.min(1440, m)); return pad(Math.floor(m / 60) % 24 === 0 && m === 1440 ? 24 : Math.floor(m / 60)) + ":" + pad(m % 60); }
  function dur(m) { var h = Math.floor(m / 60), r = m % 60; return (h ? h + " 小時" : "") + (r ? (h ? " " : "") + r + " 分" : ""); }
  function $(id) { return document.getElementById(id); }
  function el(tag, attrs) {
    var e = document.createElement(tag), kids = Array.prototype.slice.call(arguments, 2);
    for (var k in (attrs || {})) { if (k === "class") e.className = attrs[k]; else if (k === "style") e.style.cssText = attrs[k]; else e.setAttribute(k, attrs[k]); }
    kids.forEach(function (c) { if (c == null) return; e.append(c.nodeType ? c : document.createTextNode(String(c))); });
    return e;
  }
  function settings() { data.settings = data.settings || {}; data.settings.labels = data.settings.labels || {}; data.settings.apps = data.settings.apps || {}; return data.settings; }
  function catName(cat) { return (data.settings && data.settings.labels && data.settings.labels[cat]) || cat; }
  function appName(a) { return (data.settings && data.settings.apps && data.settings.apps[a.cls]) || a.name; }
  function tc(cat) { return "--tc:var(" + (CATS[cat] || "--c-misc") + ")"; }
  function isEvent(t) { return t.kind ? t.kind === "event" : !!t.milestone; }
  function habitsOn(date) {
    var dow = parse(date).getDay();
    return (data.habits || []).filter(function (h) { return h.days.indexOf(dow) >= 0 && date >= h.start && (!h.end || date <= h.end); });
  }
  function byTime(a, b) { return (a.time || "99").localeCompare(b.time || "99"); }
  // ---------- semesters (timetables) ----------
  function terms() { if (!data.terms || !data.terms.length) data.terms = [{ id: "term1", name: "目前課表", start: "", end: "" }]; return data.terms; }
  function termOf(c) { var ts = terms(); for (var i = 0; i < ts.length; i++) if (ts[i].id === c.termId) return ts[i]; return ts[0]; }
  function termCovers(t, date) { return (!t.start || date >= t.start) && (!t.end || date <= t.end); }
  function termFor(date) { var ts = terms(); for (var i = ts.length - 1; i >= 0; i--) if (termCovers(ts[i], date)) return ts[i]; return null; }
  function classesOn(date) { var dow = parse(date).getDay(); return data.classes.filter(function (c) { return c.day === dow && termCovers(termOf(c), date); }); }
  var weekTerm = null;
  function wakeMin() { return mins(settings().wake || "07:00"); }
  function sleepMin() { var s = mins(settings().sleep || "00:00"); return s <= wakeMin() ? s + 1440 : s; }

  // Everything that happens on a date, in one shape.
  function entriesOn(date) {
    var out = [];
    classesOn(date).forEach(function (c) {
      out.push({ type: "class", obj: c, title: c.name, cat: c.kind, start: mins(c.start), end: mins(c.end), event: true, fixed: true, sub: c.room || "", done: false });
    });
    data.tasks.filter(function (t) { return t.date === date; }).forEach(function (t) {
      var ev = isEvent(t), s = mins(t.time), e = mins(t.endTime);
      out.push({ type: "task", obj: t, title: t.title, cat: t.cat, start: s, end: s == null ? null : (e != null && e > s ? e : s + (ev ? 60 : 30)), event: ev, sub: t.note || "", done: !!t.done });
    });
    habitsOn(date).forEach(function (h) {
      var s = mins(h.time), e = mins(h.endTime);
      out.push({ type: "habit", obj: h, title: h.title, cat: h.cat, start: s, end: s == null ? null : (e != null && e > s ? e : s + 30), event: false, sub: "↻", done: !!(h.doneDates && h.doneDates[date]) });
    });
    return out;
  }
  function autoInfo(obj, date) {
    var a = data.auto; if (!a || a.date !== date) return "";
    if (obj.goalKm && a.runKm != null) return "Strava " + a.runKm + "/" + obj.goalKm + "K";
    if (obj.link === "epop" && a.epopMin != null) return "今天已用 " + a.epopMin + "/" + (settings().epopMin || 10) * (obj.epopSlot || 1) + " 分";
    return "";
  }
  function setDone(en, date, val) {
    if (en.type === "task") en.obj.done = val;
    else { en.obj.doneDates = en.obj.doneDates || {}; if (val) en.obj.doneDates[date] = true; else delete en.obj.doneDates[date]; }
    persist(); renderAll();
  }

  // ---------- storage ----------
  var loaded = false;   // never save before the real data has been read (would wipe it)
  function persist() {
    if (!loaded) return;
    var json = JSON.stringify(data);
    try { localStorage.setItem(KEY, json); } catch (e) {}
    if (NATIVE) { try { window.Android.save(json); } catch (e) {} }
    else if ("caches" in window) {
      caches.open("sched-data").then(function (c) {
        return c.put("./__data.json", new Response(json, { headers: { "Content-Type": "application/json" } }));
      }).catch(function () {});
    }
  }
  function normalize(d) { d.habits = d.habits || []; d.classes = d.classes || []; d.tasks = d.tasks || []; d.settings = d.settings || {}; data = d; terms(); return d; }
  function readStored() {
    var s = null;
    if (NATIVE) { try { s = window.Android.load(); } catch (e) {} }   // the widget may have changed it
    if (!s) { try { s = localStorage.getItem(KEY); } catch (e) {} }
    return s;
  }
  function load() {
    var s = readStored();
    if (s) { try { data = normalize(JSON.parse(s)); loaded = true; return Promise.resolve(); } catch (e) {} }
    return seed();
  }
  function seed() {
    return fetch("seed.json").then(function (r) { return r.json(); }).then(function (s) { data = normalize(s); loaded = true; persist(); });
  }

  // ---------- shortcuts ----------
  function renderShortcuts() {
    var box = $("shortcuts"); box.replaceChildren();
    APPS.forEach(function (a) {
      var b = el("a", { class: "sc " + a.cls, href: a.web, target: "_blank", rel: "noopener" }, el("i", {}, a.letter), appName(a));
      b.addEventListener("click", function (e) {
        if (NATIVE) { e.preventDefault(); window.Android.openApp(a.pkg, a.web); return; }
        if (/Android/i.test(navigator.userAgent)) {
          e.preventDefault();
          location.href = "intent://#Intent;action=android.intent.action.MAIN;category=android.intent.category.LAUNCHER;package=" + a.pkg + ";S.browser_fallback_url=" + encodeURIComponent(a.web) + ";end";
        }
      });
      box.append(b);
    });
  }

  // ---------- list rows (upcoming tab) ----------
  function editable(node, type, obj) {
    node.setAttribute("role", "button"); node.setAttribute("tabindex", "0");
    node.addEventListener("click", function (e) { if (e.target.tagName !== "INPUT") openEdit(type, obj); });
    return node;
  }
  function itemRow(t) {
    var ev = isEvent(t);
    var chk = el("input", { type: "checkbox", class: "chk", "aria-label": "完成：" + t.title });
    chk.checked = !!t.done;
    chk.addEventListener("change", function () { t.done = chk.checked; persist(); renderAll(); });
    return el("li", { class: "row" + (t.done ? " done" : ""), style: tc(t.cat) },
      el("div", { class: "t" }, t.time || (ev ? "整天" : "—")),
      editable(el("div", { class: "main" }, el("div", { class: "title" }, el("span", { class: ev ? "mk" : "mkdot" }), el("span", { class: "tx" }, t.title)), el("div", { class: "note" }, catName(t.cat) + (t.note ? " ・ " + t.note : ""))), "task", t),
      el("div", { class: "acts" }, chk));
  }

  // ---------- month ----------
  function renderMonth() {
    var grid = $("mgrid"); grid.replaceChildren();
    var p = month.split("-").map(Number), first = new Date(p[0], p[1] - 1, 1);
    $("mLabel").textContent = p[0] + " 年 " + p[1] + " 月";
    WD.forEach(function (w) { grid.append(el("div", { class: "mwd" }, w)); });
    var days = new Date(p[0], p[1], 0).getDate(), weeks = Math.ceil((first.getDay() + days) / 7);
    var start = new Date(first); start.setDate(1 - first.getDay());
    var t0 = todayStr();
    for (var i = 0; i < weeks * 7; i++) {
      var d = new Date(start); d.setDate(start.getDate() + i);
      var ds = fmt(d), dow = d.getDay();
      var all = data.tasks.filter(function (t) { return t.date === ds; });
      var evs = all.filter(isEvent).sort(byTime), tks = all.filter(function (t) { return !isEvent(t); });
      var cell = el("button", { class: "mcell" + (dow === 0 ? " sun" : dow === 6 ? " sat" : "") + (ds.slice(0, 7) !== month ? " other" : "") + (ds === t0 ? " today" : "") + (ds === viewDate ? " sel" : ""), "aria-label": label(ds) },
        el("span", { class: "mnum" }, d.getDate()));
      evs.slice(0, 2).forEach(function (t) { cell.append(el("span", { class: "bar", style: tc(t.cat) }, t.short || t.title)); });
      if (evs.length > 2) cell.append(el("span", { class: "more" }, "+" + (evs.length - 2)));
      if (tks.length) {
        var dots = el("span", { class: "dots" });
        tks.slice(0, 6).forEach(function (t) { dots.append(el("span", { class: "dot" + (t.done ? " done" : ""), style: tc(t.cat) })); });
        cell.append(dots);
      }
      (function (ds) {
        cell.addEventListener("click", function () {
          viewDate = ds; if (ds.slice(0, 7) !== month) month = ds.slice(0, 7);
          renderMonth(); setCalMode("day");
        });
      })(ds);
      grid.append(cell);
    }
  }

  // ---------- day timeline ----------
  function renderDay(scroll) {
    var body = $("dayBody"), oldWrap = body.querySelector(".tlwrap"), keepScroll = oldWrap ? oldWrap.scrollTop : null;
    body.replaceChildren();
    var isToday = viewDate === todayStr();
    $("dayLabel").replaceChildren(label(viewDate), el("small", {}, isToday ? "今天" : viewDate));
    var ens = entriesOn(viewDate);

    // untimed + overdue on top
    var top = el("div", { class: "allday" });
    if (isToday) data.tasks.filter(function (t) { return !t.done && t.date < viewDate && !isEvent(t); })
      .sort(function (a, b) { return a.date.localeCompare(b.date); })
      .forEach(function (t) { top.append(topItem({ type: "task", obj: t, title: t.title, cat: t.cat, event: false, done: false }, "逾期 " + label(t.date), true)); });
    ens.filter(function (e) { return e.start == null; }).forEach(function (e) { top.append(topItem(e, e.event ? "整天" : "未排時間")); });
    if (top.children.length) body.append(top);

    // timeline
    var wrap = el("div", { class: "tlwrap" }), tl = el("div", { class: "tl", style: "height:" + (24 * HOUR) + "px" });
    for (var h = 0; h <= 24; h++) tl.append(el("div", { class: "hr", style: "top:" + (h * HOUR) + "px" }, el("span", {}, pad(h) + ":00")));
    var wk = wakeMin(), sl = sleepMin();
    if (wk > 0) tl.append(el("div", { class: "sleep", style: "top:0;height:" + (wk / 60 * HOUR) + "px" }, el("span", {}, "睡覺")));
    if (sl < 1440) tl.append(el("div", { class: "sleep", style: "top:" + (sl / 60 * HOUR) + "px;height:" + ((1440 - sl) / 60 * HOUR) + "px" }, el("span", {}, "睡覺")));
    else if (sl > 1440) tl.append(el("div", { class: "sleep", style: "top:0;height:" + ((sl - 1440) / 60 * HOUR) + "px" }));

    var timed = ens.filter(function (e) { return e.start != null; }).sort(function (a, b) { return a.start - b.start || b.end - a.end; });
    // free time inside waking hours
    var cur = wk, dayEnd = Math.min(sl, 1440);
    timed.forEach(function (e) {
      if (e.start > cur && e.start - cur >= 30 && cur < dayEnd) addGap(tl, cur, Math.min(e.start, dayEnd));
      cur = Math.max(cur, e.end);
    });
    if (dayEnd - cur >= 30) addGap(tl, cur, dayEnd);

    // side-by-side columns for overlaps
    var groups = [], g = null;
    timed.forEach(function (e) {
      var vEnd = Math.max(e.end, e.start + 30);   // short items still take ~30 min of screen height
      if (!g || e.start >= g.end) { g = { end: vEnd, cols: [] }; groups.push(g); }
      g.end = Math.max(g.end, vEnd);
      var c = 0; while (g.cols[c] != null && g.cols[c] > e.start) c++;
      g.cols[c] = vEnd; e.col = c; e.group = g;
    });
    timed.forEach(function (e) {
      var n = e.group.cols.length, w = 100 / n;
      var top = e.start / 60 * HOUR, hgt = Math.max(30 / 60 * HOUR - 2, (e.end - e.start) / 60 * HOUR - 2);
      var chk = null;
      if (!e.fixed) {
        chk = el("input", { type: "checkbox", class: "bchk", "aria-label": "完成：" + e.title });
        chk.checked = e.done;
        chk.addEventListener("change", function () { setDone(e, viewDate, chk.checked); });
      }
      var blk = el("div", { class: "blk " + (e.event ? "event" : "task") + (e.fixed ? " fixed" : "") + (e.done ? " done" : ""), style: tc(e.cat) + ";top:" + top + "px;height:" + hgt + "px;left:calc(" + (e.col * w) + "% + 1px);width:calc(" + w + "% - 3px)" },
        el("b", {}, e.title), el("small", {}, hhmm(e.start) + "–" + hhmm(e.end) + (e.sub && e.sub !== "↻" ? " ・ " + e.sub : e.sub === "↻" ? " ↻" : "") + (autoInfo(e.obj, viewDate) ? " ・ " + autoInfo(e.obj, viewDate) : "")), chk);
      editable(blk, e.type, e.obj);
      tl.append(blk);
    });

    if (isToday) { var n = new Date(); tl.append(el("div", { class: "now", style: "top:" + ((n.getHours() * 60 + n.getMinutes()) / 60 * HOUR) + "px" })); }
    wrap.append(tl); body.append(wrap);
    if (scroll || keepScroll == null) {
      var focus = isToday ? new Date().getHours() * 60 + new Date().getMinutes() - 60 : (timed.length ? timed[0].start - 30 : wk);
      wrap.scrollTop = Math.max(0, focus / 60 * HOUR);
      // on the day page the whole page scrolls (one smooth scroll, no box-inside-a-box)
      if (scroll && calMode === "day" && !$("v-cal").hidden) {
        var y = wrap.getBoundingClientRect().top + window.scrollY + Math.max(0, focus) / 60 * HOUR - 110;
        window.scrollTo(0, Math.max(0, y));
      }
    } else wrap.scrollTop = keepScroll;
  }
  function topItem(e, tag, overdue) {
    var chk = el("input", { type: "checkbox", class: "chk", "aria-label": "完成：" + e.title });
    chk.checked = e.done;
    chk.addEventListener("change", function () { setDone(e, viewDate, chk.checked); });
    var tx = el("span", { class: "tx" }, e.title);
    tx.addEventListener("click", function () { openEdit(e.type, e.obj); });
    return el("div", { class: "adi" + (e.event ? "" : " adot") + (e.done ? " done" : "") + (overdue ? " overdue" : ""), style: tc(e.cat) }, tx, el("small", {}, tag), chk);
  }
  function addGap(tl, a, b) {
    var top = a / 60 * HOUR + 2, hgt = (b - a) / 60 * HOUR - 4;
    var gap = el("button", { class: "gap", style: "top:" + top + "px;height:" + hgt + "px", "aria-label": "空檔 " + dur(b - a) + "，點一下新增" }, "空檔 " + dur(b - a), hgt > 40 ? el("span", { style: "font-weight:400" }, "・點一下排事情") : null);
    gap.addEventListener("click", function () { openSheet(viewDate, hhmm(a), hhmm(Math.min(b, a + 60))); });
    tl.append(gap);
  }

  // ---------- other views ----------
  function renderFilters() {
    var box = $("filters"); box.replaceChildren();
    ["全部", "事件", "任務"].concat(ITEM_CATS).forEach(function (c) {
      var b = el("button", { class: "chip", "aria-pressed": String(filter === c) }, catName(c));
      b.addEventListener("click", function () { filter = c; renderFilters(); renderUpcoming(); });
      box.append(b);
    });
  }
  function renderUpcoming() {
    var box = $("upcoming"); box.replaceChildren();
    var start = todayStr(), end = addDays(start, 13);
    var list = data.tasks.filter(function (t) {
      if (t.date < start || t.date > end) return false;
      if (filter === "全部") return true;
      if (filter === "事件") return isEvent(t);
      if (filter === "任務") return !isEvent(t);
      return t.cat === filter;
    });
    if (!list.length) { box.append(el("p", { class: "empty" }, "接下來兩週沒有符合的事項。")); return; }
    var by = {};
    list.forEach(function (t) { (by[t.date] = by[t.date] || []).push(t); });
    Object.keys(by).sort().forEach(function (date) {
      var ul = el("ul", { class: "rows" });
      by[date].sort(function (a, b) { return (isEvent(b) - isEvent(a)) || byTime(a, b); }).forEach(function (t) { ul.append(itemRow(t)); });
      var diff = Math.round((parse(date) - parse(start)) / 864e5);
      box.append(el("div", { class: "card up" }, el("div", { class: "uphead" }, label(date), el("span", {}, diff === 0 ? "今天" : diff === 1 ? "明天" : diff + " 天後")), ul));
    });
  }
  function renderWeek() {
    var box = $("week"); box.replaceChildren();
    var ts = terms();
    if (!weekTerm || ts.indexOf(weekTerm) < 0) weekTerm = termFor(todayStr()) || ts[ts.length - 1];
    // semester chips
    var chips = el("div", { class: "chips" });
    ts.forEach(function (t) {
      var b = el("button", { class: "chip", "aria-pressed": String(t === weekTerm) }, t.name + (termFor(todayStr()) === t ? "（目前）" : ""));
      b.addEventListener("click", function () { weekTerm = t; renderWeek(); });
      chips.append(b);
    });
    var nb = el("button", { class: "chip" }, "＋ 換新課表");
    nb.addEventListener("click", newTerm);
    chips.append(nb);
    box.append(chips);
    // semester details
    var t = weekTerm;
    var nm = el("input", { value: t.name, maxlength: "16", "aria-label": "課表名稱" });
    var st = el("input", { type: "date", value: t.start || "", "aria-label": "開始日期" });
    var en = el("input", { type: "date", value: t.end || "", "aria-label": "結束日期" });
    nm.addEventListener("input", function () { t.name = nm.value.trim() || "課表"; savedSoon(); });
    nm.addEventListener("change", renderWeek);
    st.addEventListener("change", function () { t.start = st.value; persist(); renderAll(); });
    en.addEventListener("change", function () { t.end = en.value; persist(); renderAll(); });
    var del = null;
    if (ts.length > 1) {
      var armed = false;
      del = el("button", { class: "btn danger", type: "button" }, "刪除這份課表");
      del.addEventListener("click", function () {
        if (!armed) { armed = true; del.textContent = "再按一次確認（裡面的固定行程也會刪掉）"; return; }
        data.classes = data.classes.filter(function (c) { return termOf(c) !== t; });
        data.terms = ts.filter(function (x) { return x !== t; }); weekTerm = null; persist(); renderAll();
      });
    }
    box.append(el("div", { class: "card", style: "padding:12px;margin-bottom:12px" },
      el("div", { class: "rename", style: "padding:0" }, el("span", {}, "名稱"), nm, el("span", {}, "開始"), st, el("span", {}, "結束"), en),
      el("p", { class: "status", style: "margin:8px 0 0" }, "日期留空代表不限。到了結束日期之後，這份課表就不會再出現在月曆和小工具上。"),
      del ? el("div", { style: "margin-top:10px" }, del) : null));
    var mine = data.classes.filter(function (c) { return termOf(c) === t; });
    if (!mine.length) { box.append(el("p", { class: "empty" }, "這份課表還沒有固定行程。按上面的按鈕新增，或到「設定 → 備份 → 匯入」選 Claude 給你的檔案。")); return; }
    [1, 2, 3, 4, 5, 6, 0].forEach(function (d) {
      var cs = mine.filter(function (c) { return c.day === d; }).sort(function (a, b) { return a.start.localeCompare(b.start); });
      if (!cs.length) return;
      var card = el("div", { class: "card wd" }, el("h3", {}, "星期" + WD[d]));
      cs.forEach(function (c) {
        card.append(editable(el("div", { class: "cls", style: tc(c.kind) }, el("span", { class: "t" }, c.start + "–" + c.end), el("span", { style: "min-width:0" }, c.name + (c.room ? "（" + c.room + "）" : ""))), "class", c));
      });
      box.append(card);
    });
  }
  function newTerm() {
    var ts = terms(), today = todayStr(), cur = termFor(today);
    var t = { id: "term" + Date.now(), name: "新課表", start: today, end: "" };
    if (cur && !cur.end) cur.end = addDays(today, -1);
    // keep non-class routines (校隊、社團…) in the new timetable
    data.classes.filter(function (c) { return cur && termOf(c) === cur && c.kind !== "課程"; }).forEach(function (c, i) {
      var copy = JSON.parse(JSON.stringify(c)); copy.id = "f" + Date.now() + i; copy.termId = t.id; data.classes.push(copy);
    });
    ts.push(t); weekTerm = t; persist(); renderAll();
  }
  function renderCountdowns() {
    var box = $("countdowns"); box.replaceChildren(); var t0 = todayStr();
    data.tasks.filter(function (t) { return t.milestone && t.date >= t0; }).sort(function (a, b) { return a.date.localeCompare(b.date); }).slice(0, 2)
      .forEach(function (t) {
        var n = Math.round((parse(t.date) - parse(t0)) / 864e5);
        box.append(el("span", { class: "cd" }, t.short || t.title, el("b", {}, n === 0 ? "今天" : "D-" + n)));
      });
  }
  function renderAll() { renderCountdowns(); renderMonth(); renderDay(); renderUpcoming(); renderWeek(); renderWeekly(); }

  // ---------- reminders ----------
  // minutes before; for events & tasks also "days before" (rings at 20:00 that evening). -31 = 3 days AND 1 day before
  var REMIND = [["-1", "不提醒"], ["0", "準時"], ["5", "5 分鐘前"], ["10", "10 分鐘前"], ["15", "15 分鐘前"], ["30", "30 分鐘前"], ["60", "1 小時前"]];
  var REMIND_TASK = [["-31", "前 3 天和前 1 天（晚上 8 點）"], ["1440", "前 1 天（晚上 8 點）"], ["4320", "前 3 天（晚上 8 點）"]].concat(REMIND);
  function remindKind(isClass) { return isClass === true ? "class" : isClass === false ? "habit" : isClass; }
  function remindDefault(k) {
    k = remindKind(k); var s = settings();
    var v = k === "class" ? s.remindClass : k === "habit" ? s.remindOther : s.remindTask;
    return v == null ? (k === "task" ? -31 : 10) : v;
  }
  function fillRemind(selEl, withDefault, k) {
    k = remindKind(k); selEl.replaceChildren();
    var list = k === "task" ? REMIND_TASK : REMIND;
    if (withDefault) { var d = remindDefault(k), lab = (list.filter(function (r) { return +r[0] === d; })[0] || ["", d + " 分鐘前"])[1]; selEl.append(el("option", { value: "" }, "預設（" + lab + "）")); }
    list.forEach(function (r) { selEl.append(el("option", { value: r[0] }, r[1])); });
  }

  // ---------- weekly review ----------
  var weekOffset = 0;
  function mondayOf(dateStr) { var d = parse(dateStr), k = (d.getDay() + 6) % 7; d.setDate(d.getDate() - k); return fmt(d); }
  function weekStats(mon) {
    var days = []; for (var i = 0; i < 7; i++) days.push(addDays(mon, i));
    var last = days[6], today = todayStr(), upTo = today < last ? today : last;
    var tasks = data.tasks.filter(function (t) { return t.date >= mon && t.date <= last && !isEvent(t); });
    var due = tasks.filter(function (t) { return t.date <= upTo; });
    var byCat = {};
    function add(cat, done) { var c = byCat[cat] = byCat[cat] || { done: 0, total: 0 }; c.total++; if (done) c.done++; }
    due.forEach(function (t) { add(t.cat, t.done); });
    var habitDone = 0, habitTotal = 0;
    days.filter(function (d) { return d <= upTo; }).forEach(function (d) {
      habitsOn(d).forEach(function (h) { var ok = !!(h.doneDates && h.doneDates[d]); habitTotal++; if (ok) habitDone++; add(h.cat, ok); });
    });
    var runDone = 0, runPlan = 0;
    tasks.forEach(function (t) { if (t.goalKm) { runPlan += t.goalKm; if (t.done) runDone += t.goalKm; } });
    var done = due.filter(function (t) { return t.done; }).length + habitDone, total = due.length + habitTotal;
    return { mon: mon, last: last, done: done, total: total, byCat: byCat, runDone: runDone, runPlan: runPlan, future: today < mon };
  }
  function renderWeekly() {
    var box = $("weekly"); if (!box) return; box.replaceChildren();
    var mon = addDays(mondayOf(todayStr()), weekOffset * 7), w = weekStats(mon);
    var prev = el("button", { class: "ib", type: "button", "aria-label": "上一週" }, "‹"), next = el("button", { class: "ib", type: "button", "aria-label": "下一週" }, "›");
    prev.addEventListener("click", function () { weekOffset--; renderWeekly(); });
    next.addEventListener("click", function () { if (weekOffset < 0) { weekOffset++; renderWeekly(); } });
    next.disabled = weekOffset >= 0;
    var title = weekOffset === 0 ? "這週" : weekOffset === -1 ? "上週" : (-weekOffset) + " 週前";
    box.append(el("div", { class: "wk-head" }, prev, el("b", {}, title + "（" + label(w.mon).replace(/（.）/, "") + "–" + label(w.last).replace(/（.）/, "") + "）"), next));
    var pct = w.total ? Math.round(w.done / w.total * 100) : 0;
    var tone = !w.total ? "none" : pct >= 70 ? "good" : pct >= 40 ? "mid" : "low";
    var runPct = w.runPlan ? Math.min(100, Math.round(w.runDone / w.runPlan * 100)) : 0;
    box.dataset.tone = tone;
    box.append(el("div", { class: "wk-hero" },
      el("div", { class: "wk-ring", style: "--p:" + pct }, el("b", {}, pct + "%"), el("small", {}, "完成率")),
      el("div", { class: "wk-tiles" },
        el("div", { class: "wk-tile t-done" }, el("small", {}, "做完的事"), el("b", {}, w.done, el("span", {}, " / " + w.total))),
        el("div", { class: "wk-tile t-run" }, el("small", {}, "跑步"), el("b", {}, (Math.round(w.runDone * 10) / 10), el("span", {}, " / " + w.runPlan + " K")),
          el("div", { class: "wk-mini" }, el("i", { style: "width:" + runPct + "%" }))))));
    var cats = Object.keys(w.byCat).sort(function (a, b) { return w.byCat[b].total - w.byCat[a].total; });
    if (cats.length) box.append(el("div", { class: "wk-sub" }, "各分類完成度"));
    cats.forEach(function (c) {
      var x = w.byCat[c], p = x.total ? Math.round(x.done / x.total * 100) : 0;
      box.append(el("div", { class: "wk-row", style: tc(c) },
        el("div", { class: "wk-rowtop" }, el("span", { class: "wk-cat" }, el("i"), catName(c)), el("span", { class: "wk-num" }, x.done + "/" + x.total + "・" + p + "%")),
        el("div", { class: "wk-bar" }, el("i", { style: "width:" + p + "%" }))));
    });
    if (!w.total) { box.append(el("p", { class: "status" }, weekOffset === 0 ? "這週還沒有到期的事，加油！" : "這週沒有紀錄。")); return; }
    var msg = pct >= 90 ? "太強了，這週幾乎全部完成！" : pct >= 70 ? "做得很好，保持這個節奏。" : pct >= 40 ? "完成一半以上了，下週挑一兩件最重要的先做。" : "這週比較忙沒關係，下週從一件小事開始就好。";
    box.append(el("div", { class: "wk-msg" }, msg));
  }

  // ---------- sheet: add / edit ----------
  var sel = $("fCat"), editing = null, mode = "new", pickedDays = [];
  function fillCats(list) { var v = sel.value; sel.replaceChildren(); (list || ITEM_CATS).forEach(function (c) { sel.append(el("option", { value: c }, catName(c))); }); if (v) sel.value = v; }
  fillCats();
  function renderDaySel() {
    var box = $("daySel"); box.replaceChildren();
    [1, 2, 3, 4, 5, 6, 0].forEach(function (d) {
      var b = el("button", { type: "button", "aria-pressed": String(pickedDays.indexOf(d) >= 0) }, WD[d]);
      b.addEventListener("click", function () { var i = pickedDays.indexOf(d); if (i >= 0) pickedDays.splice(i, 1); else pickedDays.push(d); renderDaySel(); });
      box.append(b);
    });
  }
  function setKind(k) {
    kind = k;
    $("kEvent").setAttribute("aria-pressed", String(k === "event"));
    $("kTask").setAttribute("aria-pressed", String(k === "task"));
    $("repeatWrap").hidden = k === "event" || mode !== "new";
    $("kindHint").textContent = k === "event" ? "事件：考試、聚會、比賽這類偶發的事，月曆上顯示成色條。" : "任務：要完成的事，月曆上顯示成小圓點。可以設定每天或每週重複。";
  }
  $("kEvent").onclick = function () { setKind("event"); };
  $("kTask").onclick = function () { setKind("task"); };
  function showFields(m) {
    mode = m;
    var fixed = m === "class" || m === "fixed";
    $("kindSeg").hidden = m !== "new"; $("kindHint").hidden = m !== "new";
    $("dateWrap").hidden = fixed || m === "habit";
    $("fDate").required = !fixed && m !== "habit";
    $("repeatWrap").hidden = m !== "new" || kind === "event";
    $("roomWrap").hidden = !fixed;
    $("daySel").hidden = m !== "fixed";
    $("timeLbl").textContent = fixed ? "開始" : "開始時間（可空白）";
    $("fTime").required = fixed; $("fEnd").required = fixed;
    $("catLbl").textContent = fixed ? "類型" : "分類";
    fillCats(fixed ? FIXED_CATS : ITEM_CATS);
    $("deleteBtn").hidden = m === "new" || m === "fixed";
    fillRemind($("fRemind"), true, fixed ? "class" : m === "habit" ? "habit" : "task"); $("fRemind").value = "";
    toggleGoal();
    $("submitBtn").textContent = (m === "new" || m === "fixed") ? "加入" : "儲存";
  }
  function toggleGoal() { $("goalWrap").hidden = !(sel.value === "跑步" && (mode === "new" || mode === "task")); }
  sel.addEventListener("change", toggleGoal);
  function showDialog() { var dlg = $("sheet"); if (dlg.showModal) dlg.showModal(); else dlg.setAttribute("open", ""); }
  function clearFields() { ["fTitle", "fNote", "fTime", "fEnd", "fRoom", "fGoal"].forEach(function (id) { $(id).value = ""; }); $("fRepeat").value = ""; }
  function openSheet(date, start, end) {
    editing = null; clearFields();
    $("fDate").value = date || viewDate;
    if (start) $("fTime").value = start; if (end) $("fEnd").value = end;
    $("sheetTitle").textContent = "新增到 " + label($("fDate").value) + (start ? " " + start : "");
    showFields("new"); setKind(kind);
    showDialog();
    setTimeout(function () { $("fTitle").focus(); }, 50);
  }
  function openFixed() {
    editing = null; clearFields(); pickedDays = [parse(viewDate).getDay()];
    showFields("fixed"); renderDaySel(); sel.value = "課程";
    $("sheetTitle").textContent = "新增固定行程到「" + (weekTerm || termFor(todayStr()) || terms()[0]).name + "」";
    showDialog();
  }
  function openEdit(type, obj) {
    editing = { type: type, obj: obj }; clearFields();
    showFields(type);
    $("fTitle").value = type === "class" ? obj.name : obj.title;
    $("fNote").value = obj.note || "";
    if (obj.remind != null) $("fRemind").value = String(obj.remind);
    if (type === "class") { $("fTime").value = obj.start; $("fEnd").value = obj.end; $("fRoom").value = obj.room || ""; sel.value = obj.kind || "課程"; $("sheetTitle").textContent = "編輯固定行程（星期" + WD[obj.day] + "）"; }
    else {
      $("fTime").value = obj.time || ""; $("fEnd").value = obj.endTime || "";
      if (ITEM_CATS.indexOf(obj.cat) >= 0) sel.value = obj.cat;
      if (type === "task") { $("fDate").value = obj.date; $("fGoal").value = obj.goalKm || ""; }
      toggleGoal();
      $("sheetTitle").textContent = type === "habit" ? "編輯重複任務" : (isEvent(obj) ? "編輯事件" : "編輯任務");
    }
    var armed = false; $("deleteBtn").textContent = "刪除這一項";
    $("deleteBtn").onclick = function () {
      if (!armed) { armed = true; $("deleteBtn").textContent = "再按一次確認刪除"; return; }
      if (type === "task") data.tasks = data.tasks.filter(function (x) { return x !== obj; });
      if (type === "habit") data.habits = data.habits.filter(function (x) { return x !== obj; });
      if (type === "class") data.classes = data.classes.filter(function (x) { return x !== obj; });
      persist(); renderAll(); $("sheet").close();
    };
    showDialog();
  }
  window.openQuickAdd = function (date) { openSheet(date || todayStr()); };
  function currentView() { var v = document.querySelector(".view:not([hidden])"); return v ? v.id : "v-cal"; }
  // Android back button: close the form → leave the day page → back to the calendar tab → (only then) leave the app
  window.handleBack = function () {
    var dlg = $("sheet");
    if (dlg.open) { dlg.close(); return true; }
    if (currentView() !== "v-cal") { showView("v-cal"); return true; }
    if (calMode === "day") { setCalMode("month"); return true; }
    return false;
  };
  window.goView = function (v) {
    var dlg = $("sheet"); if (dlg.open) dlg.close();
    if (v === "report") showView("v-report");
    else { showView("v-cal"); if (v === "day") { viewDate = todayStr(); month = viewDate.slice(0, 7); setCalMode("day"); } else setCalMode("month"); }
  };
  $("fDate").addEventListener("change", function () { if ($("fDate").value && mode === "new") $("sheetTitle").textContent = "新增到 " + label($("fDate").value); });
  $("cancelBtn").onclick = function () { $("sheet").close(); };
  $("fab").onclick = function () { if (!$("v-week").hidden) openFixed(); else openSheet(viewDate); };
  $("addFixed").onclick = openFixed;
  $("addForm").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var title = $("fTitle").value.trim(); if (!title) return;
    var start = $("fTime").value || "", end = $("fEnd").value || "", note = $("fNote").value.trim();
    if (mode === "fixed") {
      if (!pickedDays.length) { $("sheetTitle").textContent = "請至少選一天"; return; }
      var tid = (weekTerm || termFor(todayStr()) || terms()[0]).id;
      pickedDays.forEach(function (d, i) { var c = { id: "f" + Date.now() + i, termId: tid, day: d, start: start, end: end, name: title, room: $("fRoom").value.trim(), kind: sel.value, note: note }; applyRemind(c); data.classes.push(c); });
    } else if (editing) {
      var o = editing.obj; applyRemind(o);
      if (editing.type === "class") { o.name = title; o.start = start || o.start; o.end = end || o.end; o.room = $("fRoom").value.trim(); o.note = note; o.kind = sel.value; }
      else {
        o.title = title; o.time = start; o.cat = sel.value; o.note = note;
        if (end) o.endTime = end; else delete o.endTime;
        if (editing.type === "task" && $("fDate").value) { if (o.date !== $("fDate").value) delete o.short; o.date = $("fDate").value; }
        if (editing.type === "task") { var g = parseFloat($("fGoal").value); if (o.cat === "跑步" && g > 0) o.goalKm = g; else delete o.goalKm; }
      }
    } else {
      var t = { id: "u" + Date.now(), kind: kind, title: title, date: $("fDate").value, time: start, cat: sel.value, note: note, done: false };
      if (end) t.endTime = end;
      var gk = parseFloat($("fGoal").value); if (t.cat === "跑步" && gk > 0) t.goalKm = gk;
      var rp = kind === "task" ? $("fRepeat").value : "";
      applyRemind(t);
      if (rp) { var hb = { id: t.id, title: title, cat: t.cat, time: start, endTime: end || undefined, note: note, start: t.date, end: "", days: rp === "daily" ? [0, 1, 2, 3, 4, 5, 6] : [parse(t.date).getDay()], doneDates: {} }; if (t.remind != null && t.remind >= -1 && t.remind < 1440) hb.remind = t.remind; data.habits.push(hb); }
      else data.tasks.push(t);
      viewDate = t.date; month = t.date.slice(0, 7);
    }
    persist(); renderAll(); $("sheet").close(); editing = null;
  });
  function applyRemind(o) { var v = $("fRemind").value; if (v === "") delete o.remind; else o.remind = parseInt(v, 10); }

  // ---------- calendar: month grid and day schedule are two separate pages ----------
  var calMode = "month";
  function measureTop() { var h = document.querySelector("header.top"); if (h) document.documentElement.style.setProperty("--toph", h.offsetHeight + "px"); }
  window.addEventListener("resize", measureTop);
  function setCalMode(m) {
    calMode = m; measureTop();
    $("v-cal").dataset.mode = m;
    $("cmMonth").setAttribute("aria-pressed", String(m === "month"));
    $("cmDay").setAttribute("aria-pressed", String(m === "day"));
    window.scrollTo(0, 0);
    if (m === "day") renderDay(true); else renderMonth();
  }
  $("cmMonth").onclick = function () { setCalMode("month"); };
  $("cmDay").onclick = function () { setCalMode("day"); };

  // ---------- tabs & nav ----------
  function showView(id) {
    if (id === "v-report") { if (report) { settings().readReport = report.date; persist(); $("rdot").hidden = true; } openReport(report); }
    document.querySelectorAll("nav.tabs button").forEach(function (x) { if (x.dataset.view === id) x.setAttribute("aria-current", "page"); else x.removeAttribute("aria-current"); });
    document.querySelectorAll(".view").forEach(function (v) { v.hidden = v.id !== id; });
    $("fab").hidden = id === "v-set" || id === "v-report";
    window.scrollTo(0, 0);
  }
  document.querySelectorAll("nav.tabs button").forEach(function (b) {
    b.addEventListener("click", function () { showView(b.dataset.view); });
  });
  function pick(d) { viewDate = d; month = d.slice(0, 7); renderMonth(); renderDay(true); }
  $("prev").onclick = function () { pick(addDays(viewDate, -1)); };
  $("next").onclick = function () { pick(addDays(viewDate, 1)); };
  $("goToday").onclick = function () { pick(todayStr()); };
  $("dayToday").onclick = function () { pick(todayStr()); };
  $("mPrev").onclick = function () { var p = month.split("-").map(Number); month = fmt(new Date(p[0], p[1] - 2, 1)).slice(0, 7); renderMonth(); };
  $("mNext").onclick = function () { var p = month.split("-").map(Number); month = fmt(new Date(p[0], p[1], 1)).slice(0, 7); renderMonth(); };

  // ---------- settings ----------
  function setStatus(m) { $("setStatus").textContent = m; }
  if (NATIVE) $("notifyRow").hidden = true;
  function notifyState() {
    if (!("Notification" in window)) { $("notifyBtn").disabled = true; $("notifyBtn").textContent = "不支援"; return; }
    if (Notification.permission === "granted") $("notifyBtn").textContent = "已開啟";
  }
  function registerDaily() {
    if (!("serviceWorker" in navigator)) return Promise.resolve(false);
    return navigator.serviceWorker.ready.then(function (reg) {
      if (!reg.periodicSync) return false;
      return navigator.permissions.query({ name: "periodic-background-sync" }).then(function (p) {
        if (p.state !== "granted") return false;
        return reg.periodicSync.register("daily-summary", { minInterval: 12 * 60 * 60 * 1000 }).then(function () { return true; });
      });
    }).catch(function () { return false; });
  }
  $("notifyBtn").onclick = function () {
    if (!("Notification" in window)) return;
    Notification.requestPermission().then(function (p) {
      notifyState();
      if (p !== "granted") { setStatus("通知被拒絕了，請到手機設定裡打開。"); return; }
      registerDaily().then(function (ok) { setStatus(ok ? "每日提醒已開啟。" : "通知已開啟；要先把 App 加到主畫面，背景提醒才會運作。"); });
    });
  };
  $("exportBtn").onclick = function () {
    var json = JSON.stringify(data, null, 1);
    if (NATIVE) { window.Android.exportData(json); return; }
    var a = el("a", { href: URL.createObjectURL(new Blob([json], { type: "application/json" })), download: "日程備份-" + todayStr() + ".json" });
    document.body.append(a); a.click(); a.remove();
  };
  function refreshEverything() { fillCats(); renderShortcuts(); renderFilters(); applyTitle(); renderRename(); renderAuto(); renderPush(); renderQuote(); renderAll(); }
  $("importFile").onchange = function (e) {
    var f = e.target.files[0]; if (!f) return;
    f.text().then(function (txt) {
      var d = JSON.parse(txt);
      if (!d || !Array.isArray(d.tasks) || !Array.isArray(d.classes)) throw new Error("bad");
      data = normalize(d); loaded = true; persist(); refreshEverything(); setStatus("已匯入。");
    }).catch(function () { setStatus("這不是這個 App 的備份檔。"); });
    e.target.value = "";
  };
  var resetArmed = false;
  $("resetBtn").onclick = function () {
    if (!resetArmed) { resetArmed = true; $("resetBtn").textContent = "再按一次確認"; setTimeout(function () { resetArmed = false; $("resetBtn").textContent = "還原"; }, 3000); return; }
    seed().then(function () { refreshEverything(); setStatus("已還原成初始日程。"); });
  };

  // ---------- rename & routine ----------
  var saveTimer = null;
  function savedSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(function () { persist(); $("renameStatus").textContent = "已儲存。"; }, 400); }
  function applyTitle() { var t = settings().title || "Wade 的日程表"; $("appTitle").textContent = t; document.title = t; }
  function renderRename() {
    $("sTitle").value = settings().title || "Wade 的日程表";
    $("sWake").value = settings().wake || "07:00";
    $("sSleep").value = settings().sleep || "00:00";
    var cb = $("catRename"); cb.replaceChildren();
    FIXED_CATS.forEach(function (c) {
      var inp = el("input", { value: catName(c), maxlength: "8", "aria-label": c + " 的新名稱" });
      inp.addEventListener("input", function () { var v = inp.value.trim(); if (v && v !== c) settings().labels[c] = v; else delete settings().labels[c]; fillCats(); renderFilters(); renderAll(); savedSoon(); });
      cb.append(el("span", { style: tc(c) }, el("i"), c), inp);
    });
    var ab = $("appRename"); ab.replaceChildren();
    APPS.forEach(function (a) {
      var inp = el("input", { value: appName(a), maxlength: "10", "aria-label": a.name + " 按鈕的名稱" });
      inp.addEventListener("input", function () { var v = inp.value.trim(); if (v && v !== a.name) settings().apps[a.cls] = v; else delete settings().apps[a.cls]; renderShortcuts(); savedSoon(); });
      ab.append(el("span", {}, a.name), inp);
    });
  }
  $("sTitle").addEventListener("input", function () { var v = $("sTitle").value.trim(); if (v) settings().title = v; else delete settings().title; applyTitle(); savedSoon(); });
  $("sWake").addEventListener("change", function () { if ($("sWake").value) settings().wake = $("sWake").value; renderDay(); savedSoon(); });
  $("sSleep").addEventListener("change", function () { if ($("sSleep").value) settings().sleep = $("sSleep").value; renderDay(); savedSoon(); });

  // ---------- today card: quote + article ----------
  var DAILY_URL = "https://a0906330059-cloud.github.io/schedule/daily.json";
  var builtInQuotes = [];
  function myQuotes() { return (settings().quotes || "").split("\n").map(function (x) { return x.trim(); }).filter(Boolean); }
  function quoteFor(date) {
    var list = myQuotes(); if (!list.length) list = builtInQuotes; if (!list.length) return "";
    var n = Math.floor(parse(date) / 864e5); return list[((n % list.length) + list.length) % list.length];
  }
  function renderQuote() { $("quote").textContent = quoteFor(todayStr()) || "今天也加油。"; }
  fetch("quotes.json").then(function (r) { return r.json(); }).then(function (q) { builtInQuotes = q; renderQuote(); }).catch(function () { renderQuote(); });
  function renderArticles(d) {
    if (report || !d || !d.articles || !d.articles.length) return;
    var b = $("reportBody"); b.replaceChildren();
    b.append(el("p", { class: "status" }, "今天 Claude 的報告還沒好，先看看今天的新聞標題："));
    d.articles.forEach(function (a) {
      b.append(el("a", { class: "rep-cta", href: a.link, target: "_blank", rel: "noopener", style: "text-decoration:none;margin-bottom:8px" }, el("b", {}, a.title), el("small", {}, a.source + (a.summary ? " ・ " + a.summary.slice(0, 80) : ""))));
    });
  }
  // ---------- Claude's daily report ----------
  var BASE = "https://a0906330059-cloud.github.io/schedule/";
  var report = null;
  function renderReportCard() {
    if (NATIVE && report && window.Android.setReport) { try { window.Android.setReport(report.date || "", report.title || ""); } catch (e) {} }
    // already looking at the Report tab when today's report arrives → it counts as read
    if (report && !$("v-report").hidden && settings().readReport !== report.date) { settings().readReport = report.date; persist(); openReport(report, true); }
    var unread = report && report.date === todayStr() && settings().readReport !== report.date;
    $("rdot").hidden = !unread;
    if ($("v-report").hidden) openReport(report, true);
    return !!report;
  }
  function openReport(r, quiet) {
    var b = $("reportBody"); b.replaceChildren();
    if (!r) { b.append(el("p", { class: "empty" }, "今天的報告還沒準備好。Claude 每天早上大約 7:30 會寫好放上來。")); return; }
    var top = el("div", { class: "rp-top" }, el("span", { class: "rp-tag" }, r.topic + (r.date === todayStr() ? "・今天" : "・" + r.date.slice(5))));
    if (report && r !== report) { var back = el("button", { class: "ib", type: "button" }, "回到今天的報告"); back.addEventListener("click", function () { openReport(report); }); top.append(back); }
    b.append(top);
    b.append(el("h1", {}, r.title));
    b.append(el("div", { class: "rp-meta" }, (r.source || "") + (r.sourceDate ? " ・ " + r.sourceDate : "") + " ・ Claude 整理於 " + r.date));
    if (r.lead) b.append(el("div", { class: "rp-lead" }, r.lead));
    if (r.summary && r.summary.length) { b.append(el("h3", {}, "內容摘要")); r.summary.forEach(function (x) { b.append(el("p", {}, x)); }); }
    if (r.points && r.points.length) { var ul = el("ul"); r.points.forEach(function (x) { ul.append(el("li", {}, x)); }); b.append(el("h3", {}, "重點"), ul); }
    if (r.why) b.append(el("h3", {}, "為什麼值得知道"), el("p", {}, r.why));
    if (r.vocab && r.vocab.length) {
      var g = el("div", { class: "vocab" });
      r.vocab.forEach(function (v) { g.append(el("b", {}, v.en), el("span", {}, v.zh)); });
      b.append(el("h3", {}, "英文小單字"), g);
    }
    if (r.quiz && r.quiz.length) b.append(renderQuiz(r));
    var review = reviewQs(r.date);
    if (review.length) b.append(renderReview(review));
    if (r.link) b.append(el("a", { class: "rp-link", href: r.link, target: "_blank", rel: "noopener" }, "看英文原文 ›"));
    var hist = el("div", { class: "rp-hist" });
    b.append(el("h3", {}, "以前的報告"), hist);
    fetch(BASE + "reports/index.json?t=" + todayStr(), { cache: "no-store" }).then(function (x) { return x.json(); }).then(function (list) {
      list.filter(function (it) { return it.date !== r.date; }).slice(0, 14).forEach(function (it) {
        var btn = el("button", { type: "button" }, el("small", {}, it.date + " ・ " + it.topic), it.title);
        btn.addEventListener("click", function () {
          fetch(BASE + "reports/" + it.date + ".json").then(function (x) { return x.json(); }).then(openReport).catch(function () {});
        });
        hist.append(btn);
      });
      if (!hist.children.length) hist.append(el("p", { class: "status" }, "還沒有以前的報告。"));
    }).catch(function () { hist.append(el("p", { class: "status" }, "目前連不到網路。")); });
    if (!quiet) { window.scrollTo(0, 0); }
  }
  // ---------- report quiz: answer to remember, wrong ones come back later ----------
  function quizStore() { var st = settings(); st.quiz = st.quiz || {}; st.quizWrong = st.quizWrong || []; return st; }
  function qBlock(item, picked, onPick) {
    var box = el("div", { class: "qz" + (picked != null ? " answered" : "") });
    box.append(el("p", { class: "qz-q" }, item.q));
    var opts = el("div", { class: "qz-opts" });
    item.options.forEach(function (o, i) {
      var cls = "qz-opt";
      if (picked != null) { if (i === item.answer) cls += " right"; else if (i === picked) cls += " wrong"; }
      var btn = el("button", { type: "button", class: cls }, el("span", { class: "qz-l" }, "ABCD"[i]), o);
      if (picked != null) btn.disabled = true;
      btn.addEventListener("click", function () { onPick(i); });
      opts.append(btn);
    });
    box.append(opts);
    if (picked != null) box.append(el("div", { class: "qz-exp " + (picked === item.answer ? "ok" : "no") }, el("b", {}, picked === item.answer ? "答對了！" : "正確答案是 " + "ABCD"[item.answer] + "。"), " " + (item.explain || "")));
    return box;
  }
  function renderQuiz(r) {
    var st = quizStore(), ans = st.quiz[r.date] || [];
    var wrap = el("section", { class: "quiz" });
    var done = r.quiz.filter(function (_, i) { return ans[i] != null; }).length;
    var right = r.quiz.filter(function (q, i) { return ans[i] === q.answer; }).length;
    wrap.append(el("div", { class: "quiz-head" }, el("h3", {}, "小測驗"), el("span", {}, done < r.quiz.length ? "答完才算讀完：" + done + "/" + r.quiz.length : "答對 " + right + "/" + r.quiz.length)));
    if (!done) wrap.append(el("p", { class: "status" }, "先別往上偷看，憑記憶選。選錯也沒關係，錯的題目過幾天會再出現一次。"));
    r.quiz.forEach(function (q, i) {
      wrap.append(qBlock(q, ans[i], function (pick) {
        var a = st.quiz[r.date] = st.quiz[r.date] || [];
        if (a[i] != null) return;
        a[i] = pick;
        if (pick !== q.answer) st.quizWrong.push({ date: r.date, q: q.q, options: q.options, answer: q.answer, explain: q.explain || "" });
        st.quizWrong = st.quizWrong.slice(-20);
        persist();
        wrap.replaceWith(renderQuiz(r));
      }));
    });
    if (done === r.quiz.length) wrap.append(el("div", { class: "wk-msg", style: "--tone:" + (right === r.quiz.length ? "#34d399" : right * 2 >= r.quiz.length ? "#fbbf24" : "#ff6b6f") }, right === r.quiz.length ? "全對！今天這篇你真的讀懂了。" : "答錯的題目我記下來了，過兩天會在報告下面再考你一次。"));
    return wrap;
  }
  // wrong answers from at least 2 days ago come back (max 2 at a time); answer right → gone
  function reviewQs(today) { var st = quizStore(), lim = addDays(todayStr(), -2); return st.quizWrong.filter(function (w) { return w.date <= lim && w.date !== today; }).slice(0, 2); }
  function renderReview(list) {
    var wrap = el("section", { class: "quiz review" });
    wrap.append(el("div", { class: "quiz-head" }, el("h3", {}, "複習：之前答錯的題目"), el("span", {}, list.length + " 題")));
    list.forEach(function (w) {
      var slot = el("div");
      var draw = function (picked) {
        slot.replaceChildren(qBlock(w, picked, function (pick) {
          var st = quizStore();
          if (pick === w.answer) st.quizWrong = st.quizWrong.filter(function (x) { return x !== w; });
          else { st.quizWrong = st.quizWrong.filter(function (x) { return x !== w; }); w.date = todayStr(); st.quizWrong.push(w); }
          persist(); draw(pick);
        }));
      };
      draw(null);
      wrap.append(slot);
    });
    return wrap;
  }
  function loadReport() {
    var cached = null; try { cached = JSON.parse(localStorage.getItem("daily-report") || "null"); } catch (e) {}
    if (cached) { report = cached; renderReportCard(); }
    fetch(BASE + "report.json?t=" + todayStr() + Date.now() % 1000, { cache: "no-store" }).then(function (r) { if (!r.ok) throw 0; return r.json(); })
      .then(function (d) { if (!d || !d.title) throw 0; report = d; try { localStorage.setItem("daily-report", JSON.stringify(d)); } catch (e) {} renderReportCard(); })
      .catch(function () {});
  }
  function loadDaily() {
    loadReport();
    var cached = null; try { cached = JSON.parse(localStorage.getItem("daily-article") || "null"); } catch (e) {}
    if (cached) renderArticles(cached);
    fetch(DAILY_URL + "?t=" + todayStr(), { cache: "no-store" }).then(function (r) { if (!r.ok) throw 0; return r.json(); })
      .then(function (d) { try { localStorage.setItem("daily-article", JSON.stringify(d)); } catch (e) {} renderArticles(d); })
      .catch(function () {});
  }
  $("sQuotes").addEventListener("input", function () { settings().quotes = $("sQuotes").value; renderQuote(); savedSoon(); });
  function renderRemindSettings() {
    fillRemind($("sRemClass"), false, "class"); fillRemind($("sRemOther"), false, "habit"); fillRemind($("sRemTask"), false, "task");
    $("sRemClass").value = String(remindDefault("class")); $("sRemOther").value = String(remindDefault("habit")); $("sRemTask").value = String(remindDefault("task"));
  }
  $("sRemTask").addEventListener("change", function () { settings().remindTask = parseInt($("sRemTask").value, 10); persist(); });
  $("sRemClass").addEventListener("change", function () { settings().remindClass = parseInt($("sRemClass").value, 10); persist(); });
  $("sRemOther").addEventListener("change", function () { settings().remindOther = parseInt($("sRemOther").value, 10); persist(); });
  function renderPush() {
    renderRemindSettings();
    $("sQuotes").value = settings().quotes || "";
    $("sPush").value = settings().pushTime == null ? "07:30" : settings().pushTime;
    if (!NATIVE) { $("pushRow").hidden = true; return; }
  }
  $("sPush").addEventListener("change", function () {
    settings().pushTime = $("sPush").value; persist();
    if (NATIVE) window.Android.setReminder($("sPush").value);
  });
  $("pushBtn").onclick = function () { if (NATIVE) window.Android.askNotificationPermission(); };

  // ---------- auto check (Android app only) ----------
  function autoMsg(m) { $("autoMsg").textContent = m || ""; }
  function renderAuto() {
    $("sEpop").value = settings().epopMin || 10;
    if (!NATIVE) { $("autoCard").hidden = true; $("autoWebNote").hidden = false; return; }
    var st = {}; try { st = JSON.parse(window.Android.autoStatus()); } catch (e) {}
    $("stravaState").textContent = st.strava ? "已連結" : "未連結";
    if (st.strava) $("stravaBox").open = true;
    $("healthState").textContent = st.health ? "已連結" : st.healthAvail === false ? "這支手機不支援" : "未連結";
    $("healthBtn").textContent = st.health ? "重新檢查權限" : "連結 Health Connect";
    $("stravaForm").hidden = !!st.strava; $("stravaBtn").hidden = !!st.strava; $("stravaOff").hidden = !st.strava;
    if (st.clientId && !$("sCid").value) $("sCid").value = st.clientId;
    $("usageState").textContent = st.usage ? "已開啟" : "未開啟";
    $("usageBtn").textContent = st.usage ? "到系統設定查看" : "開啟「使用情形存取權」";
    var a = data.auto;
    if (a && a.date === todayStr()) autoMsg("今天：" + (a.runKm != null ? "跑了 " + a.runKm + " 公里" : "跑步還沒連結") + "，" + (a.epopMin != null ? "EPOP 共用了 " + a.epopMin + " 分" : "EPOP 未開啟權限"));
  }
  $("sEpop").addEventListener("change", function () { var n = parseInt($("sEpop").value, 10); if (n > 0) { settings().epopMin = n; persist(); } });
  $("stravaBtn").onclick = function () {
    var id = $("sCid").value.trim(), sec = $("sCsec").value.trim();
    if (!id || !sec) { autoMsg("請先填 Client ID 和 Client Secret。"); return; }
    window.Android.stravaConnect(id, sec);
  };
  var offArmed = false;
  $("stravaOff").onclick = function () {
    if (!offArmed) { offArmed = true; $("stravaOff").textContent = "再按一次確認"; return; }
    window.Android.stravaDisconnect(); offArmed = false; $("stravaOff").textContent = "取消連結"; renderAuto();
  };
  $("healthBtn").onclick = function () { if (window.Android.healthConnect) window.Android.healthConnect(); };
  $("usageBtn").onclick = function () { window.Android.openUsageSettings(); };
  $("checkNow").onclick = function () { autoMsg("檢查中…"); window.Android.checkNow(); };
  window.onAutoChecked = function (message) {
    var s2 = readStored(); if (s2) { try { data = normalize(JSON.parse(s2)); } catch (e) {} }
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) {}
    renderAll(); renderAuto(); if (message) autoMsg(message);
  };

  // ---------- boot ----------
  notifyState();
  loadDaily();
  load().then(function () {
    persist(); refreshEverything(); renderDay(true);
    if (NATIVE) window.Android.setReminder(settings().pushTime == null ? "07:30" : settings().pushTime); if (window.__pendingQuickAdd) { openSheet(window.__pendingQuickAdd); window.__pendingQuickAdd = null; } })
    .catch(function () { $("dayBody").replaceChildren(el("p", { class: "empty" }, "讀不到資料，請連上網路後重新開啟。")); });
  if (!NATIVE && "serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").then(function () {
      if ("Notification" in window && Notification.permission === "granted") registerDaily();
    }).catch(function () {});
  }
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) return;
    if (NATIVE) { var s = readStored(); if (s) { try { data = normalize(JSON.parse(s)); } catch (e) {} } }
    if (viewDate < todayStr()) { viewDate = todayStr(); month = viewDate.slice(0, 7); loadDaily(); }
    renderQuote(); renderAll();
  });
  setInterval(function () { if (!document.hidden && viewDate === todayStr()) renderDay(); }, 5 * 60 * 1000);
})();
