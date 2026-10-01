(function () {
  var KEY = "sched-data-v1";
  var CATS = { "課程": "--c-class", "校隊": "--c-team", "作業考試": "--c-hw", "跑步": "--c-run", "柳丁樹": "--c-tree", "程式": "--c-code", "英文": "--c-eng", "閱讀": "--c-read", "其他": "--c-misc" };
  var TASK_CATS = ["作業考試", "跑步", "英文", "程式", "柳丁樹", "閱讀", "其他"];
  var WD = ["日", "一", "二", "三", "四", "五", "六"];
  var data = { classes: [], tasks: [], habits: [] }, filter = "全部", viewDate = todayStr(), month = viewDate.slice(0, 7);

  function pad(n) { return String(n).padStart(2, "0"); }
  function fmt(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function todayStr() { return fmt(new Date()); }
  function parse(s) { var p = s.split("-").map(Number); return new Date(p[0], p[1] - 1, p[2]); }
  function addDays(s, n) { var d = parse(s); d.setDate(d.getDate() + n); return fmt(d); }
  function label(s) { var d = parse(s); return (d.getMonth() + 1) + "/" + d.getDate() + "（" + WD[d.getDay()] + "）"; }
  function habitsOn(date) {
    var dow = parse(date).getDay();
    return (data.habits || []).filter(function (h) { return h.days.indexOf(dow) >= 0 && date >= h.start && (!h.end || date <= h.end); });
  }
  function habitRow(h, date) {
    var chk = el("input", { type: "checkbox", class: "chk", "aria-label": "完成：" + h.title });
    var done = !!(h.doneDates && h.doneDates[date]);
    chk.checked = done;
    chk.addEventListener("change", function () { h.doneDates = h.doneDates || {}; if (chk.checked) h.doneDates[date] = true; else delete h.doneDates[date]; persist(); renderAll(); });
    var del = el("button", { class: "del", "aria-label": "刪除重複事項：" + h.title }, "✕"), armed = false;
    del.addEventListener("click", function () {
      if (!armed) { armed = true; del.textContent = "全刪?"; setTimeout(function () { armed = false; del.textContent = "✕"; }, 2500); return; }
      data.habits = data.habits.filter(function (x) { return x !== h; }); persist(); renderAll();
    });
    return el("li", { class: "row" + (done ? " done" : "") },
      el("div", { class: "t" }, h.time || "—"),
      el("div", { class: "main" }, el("div", { class: "title" }, tag(h.cat), h.title), el("div", { class: "note" }, "↻ " + (h.days.length === 7 ? "每天" : "每週" + h.days.map(function (d) { return WD[d]; }).join("")) + (h.note ? " ・ " + h.note : ""))),
      el("div", { class: "acts" }, chk, del));
  }
  function $(id) { return document.getElementById(id); }
  function el(tag, attrs) {
    var e = document.createElement(tag), kids = Array.prototype.slice.call(arguments, 2);
    for (var k in (attrs || {})) { if (k === "class") e.className = attrs[k]; else if (k === "style") e.style.cssText = attrs[k]; else e.setAttribute(k, attrs[k]); }
    kids.forEach(function (c) { if (c == null) return; e.append(c.nodeType ? c : document.createTextNode(String(c))); });
    return e;
  }
  function tag(cat) { return el("span", { class: "tag", style: "--tc:var(" + (CATS[cat] || "--c-misc") + ")" }, cat); }

  // ---------- storage ----------
  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) {}
    // copy for the service worker, which cannot read localStorage
    if ("caches" in window) {
      caches.open("sched-data").then(function (c) {
        return c.put("./__data.json", new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } }));
      }).catch(function () {});
    }
  }
  function load() {
    try { var s = localStorage.getItem(KEY); if (s) { data = JSON.parse(s); data.habits = data.habits || []; return Promise.resolve(); } } catch (e) {}
    return seed();
  }
  function seed() {
    return fetch("seed.json").then(function (r) { return r.json(); }).then(function (s) { data = s; persist(); });
  }

  // ---------- render ----------
  function taskRow(t, opt) {
    opt = opt || {};
    var chk = el("input", { type: "checkbox", class: "chk", "aria-label": "完成：" + t.title });
    chk.checked = !!t.done;
    chk.addEventListener("change", function () { t.done = chk.checked; persist(); renderAll(); });
    var del = el("button", { class: "del", "aria-label": "刪除：" + t.title }, "✕"), armed = false;
    del.addEventListener("click", function () {
      if (!armed) { armed = true; del.textContent = "刪?"; setTimeout(function () { armed = false; del.textContent = "✕"; }, 2500); return; }
      data.tasks = data.tasks.filter(function (x) { return x !== t; }); persist(); renderAll();
    });
    var noteText = (opt.overdue ? label(t.date) + (t.note ? " ・ " : "") : "") + (t.note || "");
    return el("li", { class: "row" + (t.done ? " done" : "") + (opt.overdue ? " overdue" : "") },
      el("div", { class: "t" }, opt.overdue ? "逾期" : (t.time || "—")),
      el("div", { class: "main" }, el("div", { class: "title" }, tag(t.cat), t.title), noteText ? el("div", { class: "note" }, noteText) : null),
      el("div", { class: "acts" }, chk, del));
  }
  function classRow(c) {
    return el("li", { class: "row" },
      el("div", { class: "t" }, c.start),
      el("div", { class: "main" }, el("div", { class: "title" }, tag(c.kind), c.name),
        el("div", { class: "note" }, c.start + "–" + c.end + (c.room ? " ・ " + c.room : "") + (c.note ? " ・ " + c.note : ""))),
      el("div"));
  }
  function renderToday() {
    var box = $("todayList"); box.replaceChildren();
    var isToday = viewDate === todayStr(), dow = parse(viewDate).getDay();
    $("dayLabel").replaceChildren(label(viewDate), el("small", {}, isToday ? "今天" : viewDate));
    if (isToday) data.tasks.filter(function (t) { return !t.done && t.date < viewDate && !t.milestone; })
      .sort(function (a, b) { return a.date.localeCompare(b.date); })
      .forEach(function (t) { box.append(taskRow(t, { overdue: true })); });
    var items = [];
    data.classes.filter(function (c) { return c.day === dow; }).forEach(function (c) { items.push({ k: c.start, n: classRow(c) }); });
    data.tasks.filter(function (t) { return t.date === viewDate; }).forEach(function (t) { items.push({ k: t.time || "99", n: taskRow(t) }); });
    habitsOn(viewDate).forEach(function (h) { items.push({ k: h.time || "99", n: habitRow(h, viewDate) }); });
    items.sort(function (a, b) { return a.k.localeCompare(b.k); }).forEach(function (i) { box.append(i.n); });
    if (!box.children.length) box.append(el("li", { class: "empty" }, "這天沒有排任何事，好好休息。"));
  }
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
      var evs = data.tasks.filter(function (t) { return t.date === ds; })
        .sort(function (a, b) { return (b.milestone ? 1 : 0) - (a.milestone ? 1 : 0) || (a.time || "99").localeCompare(b.time || "99"); });
      var cell = el("button", { class: "mcell" + (dow === 0 ? " sun" : dow === 6 ? " sat" : "") + (ds.slice(0, 7) !== month ? " other" : "") + (ds === t0 ? " today" : "") + (ds === viewDate ? " sel" : ""), "aria-label": label(ds) + "，" + evs.length + " 件事" },
        el("span", { class: "mnum" }, d.getDate()));
      evs.slice(0, 3).forEach(function (t) {
        cell.append(el("span", { class: "ev" + (t.done ? " done" : "") + (t.milestone ? " ms" : ""), style: "--tc:var(" + (CATS[t.cat] || "--c-misc") + ")" }, (t.short || t.title).replace(/^(Python|柳丁樹)：/, "")));
      });
      if (evs.length > 3) cell.append(el("span", { class: "more" }, "+" + (evs.length - 3)));
      (function (ds) { cell.addEventListener("click", function () { viewDate = ds; if (ds.slice(0, 7) !== month) month = ds.slice(0, 7); renderMonth(); renderToday(); }); })(ds);
      grid.append(cell);
    }
  }
  function shiftMonth(n) { var p = month.split("-").map(Number); var d = new Date(p[0], p[1] - 1 + n, 1); month = fmt(d).slice(0, 7); renderMonth(); }
  function renderFilters() {
    var box = $("filters"); box.replaceChildren();
    ["全部"].concat(TASK_CATS).forEach(function (c) {
      var b = el("button", { class: "chip", "aria-pressed": String(filter === c) }, c);
      b.addEventListener("click", function () { filter = c; renderFilters(); renderUpcoming(); });
      box.append(b);
    });
  }
  function renderUpcoming() {
    var box = $("upcoming"); box.replaceChildren();
    var start = todayStr(), end = addDays(start, 13);
    var list = data.tasks.filter(function (t) { return t.date >= start && t.date <= end && (filter === "全部" || t.cat === filter); });
    if (!list.length) { box.append(el("p", { class: "empty" }, "接下來兩週沒有事項。")); return; }
    var by = {};
    list.forEach(function (t) { (by[t.date] = by[t.date] || []).push(t); });
    Object.keys(by).sort().forEach(function (date) {
      var ul = el("ul", { class: "rows" });
      by[date].sort(function (a, b) { return (a.time || "99").localeCompare(b.time || "99"); }).forEach(function (t) { ul.append(taskRow(t)); });
      var diff = Math.round((parse(date) - parse(start)) / 864e5);
      box.append(el("div", { class: "card day" }, el("div", { class: "dayhead" }, label(date), el("span", {}, diff === 0 ? "今天" : diff === 1 ? "明天" : diff + " 天後")), ul));
    });
  }
  function renderWeek() {
    var box = $("week"); box.replaceChildren();
    if (!data.classes.length) { box.append(el("p", { class: "empty" }, "還沒有課表。到「設定 → 備份 → 匯入」選 Claude 給你的「我的日程-匯入用.json」。")); return; }
    [1, 2, 3, 4, 5, 6, 0].forEach(function (d) {
      var cs = data.classes.filter(function (c) { return c.day === d; }).sort(function (a, b) { return a.start.localeCompare(b.start); });
      if (!cs.length) return;
      var card = el("div", { class: "card wd" }, el("h3", {}, "星期" + WD[d]));
      cs.forEach(function (c) {
        card.append(el("div", { class: "cls", style: "--tc:var(" + (CATS[c.kind] || "--c-misc") + ")" },
          el("span", { class: "t" }, c.start + "–" + c.end), el("span", { style: "min-width:0" }, c.name + (c.room ? "（" + c.room + "）" : ""))));
      });
      box.append(card);
    });
  }
  function renderCountdowns() {
    var box = $("countdowns"); box.replaceChildren(); var t0 = todayStr();
    data.tasks.filter(function (t) { return t.milestone && t.date >= t0; }).sort(function (a, b) { return a.date.localeCompare(b.date); })
      .forEach(function (t) {
        var n = Math.round((parse(t.date) - parse(t0)) / 864e5);
        box.append(el("span", { class: "cd" }, t.short || t.title, el("b", {}, n === 0 ? "今天" : "D-" + n)));
      });
  }
  function renderAll() { renderCountdowns(); renderMonth(); renderToday(); renderUpcoming(); renderWeek(); }

  // ---------- tabs ----------
  document.querySelectorAll("nav.tabs button").forEach(function (b) {
    b.addEventListener("click", function () {
      document.querySelectorAll("nav.tabs button").forEach(function (x) { x.removeAttribute("aria-current"); });
      b.setAttribute("aria-current", "page");
      document.querySelectorAll(".view").forEach(function (v) { v.hidden = v.id !== b.dataset.view; });
      window.scrollTo(0, 0);
    });
  });
  function pick(d) { viewDate = d; month = d.slice(0, 7); renderMonth(); renderToday(); }
  $("prev").onclick = function () { pick(addDays(viewDate, -1)); };
  $("next").onclick = function () { pick(addDays(viewDate, 1)); };
  $("goToday").onclick = function () { pick(todayStr()); };
  $("mPrev").onclick = function () { shiftMonth(-1); };
  $("mNext").onclick = function () { shiftMonth(1); };

  // ---------- add form ----------
  var sel = $("fCat");
  TASK_CATS.forEach(function (c) { sel.append(el("option", { value: c }, c)); });
  $("fDate").value = todayStr();
  $("addForm").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var t = { id: "u" + Date.now(), title: $("fTitle").value.trim(), date: $("fDate").value, time: $("fTime").value || "", cat: sel.value, note: $("fNote").value.trim(), done: false };
    if (!t.title || !t.date) return;
    var rp = $("fRepeat").value;
    if (rp) {
      data.habits = data.habits || [];
      data.habits.push({ id: t.id, title: t.title, cat: t.cat, time: t.time, note: t.note, start: t.date, end: "", days: rp === "daily" ? [0, 1, 2, 3, 4, 5, 6] : [parse(t.date).getDay()], doneDates: {} });
    } else data.tasks.push(t);
    persist(); renderAll();
    $("status").textContent = "已加入：" + t.title;
    $("fTitle").value = ""; $("fNote").value = ""; $("fTime").value = "";
  });

  // ---------- settings ----------
  function setStatus(m) { $("setStatus").textContent = m; }
  function notifyState() {
    if (!("Notification" in window)) { $("notifyBtn").disabled = true; $("notifyBtn").textContent = "不支援"; return; }
    if (Notification.permission === "granted") $("notifyBtn").textContent = "已開啟";
    else if (Notification.permission === "denied") $("notifyBtn").textContent = "被封鎖";
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
      if (p !== "granted") { setStatus("通知被拒絕了。到手機的「設定 → 應用程式 → 這個 App → 通知」打開。"); return; }
      registerDaily().then(function (ok) {
        setStatus(ok ? "每日提醒已開啟。" : "通知已開啟，但每日背景提醒要先把 App「加到主畫面」再從主畫面打開，然後回來再按一次。");
      });
    });
  };
  $("testBtn").onclick = function () {
    if (!("Notification" in window) || Notification.permission !== "granted") { setStatus("請先按「開啟通知」。"); return; }
    var s = buildSummary(data);
    navigator.serviceWorker.ready.then(function (reg) {
      return reg.showNotification(s.title, { body: s.body, icon: "icon-192.png", badge: "icon-192.png", tag: "daily" });
    }).then(function () { setStatus("已送出測試通知。"); }).catch(function () { setStatus("送不出通知，請確認 App 是用 https 網址開的。"); });
  };
  $("exportBtn").onclick = function () {
    var blob = new Blob([JSON.stringify(data, null, 1)], { type: "application/json" });
    var a = el("a", { href: URL.createObjectURL(blob), download: "日程備份-" + todayStr() + ".json" });
    document.body.append(a); a.click(); a.remove();
  };
  $("importFile").onchange = function (e) {
    var f = e.target.files[0]; if (!f) return;
    f.text().then(function (txt) {
      var d = JSON.parse(txt);
      if (!d || !Array.isArray(d.tasks) || !Array.isArray(d.classes)) throw new Error("bad");
      d.habits = d.habits || [];
      data = d; persist(); renderAll(); setStatus("已匯入備份。");
    }).catch(function () { setStatus("這不是這個 App 的備份檔。"); });
  };
  var resetArmed = false;
  $("resetBtn").onclick = function () {
    if (!resetArmed) { resetArmed = true; $("resetBtn").textContent = "再按一次確認"; setTimeout(function () { resetArmed = false; $("resetBtn").textContent = "還原"; }, 3000); return; }
    seed().then(function () { renderAll(); setStatus("已還原成初始日程。"); });
  };

  // ---------- boot ----------
  renderFilters(); notifyState();
  load().then(function () { persist(); renderAll(); }).catch(function () {
    $("todayList").replaceChildren(el("li", { class: "empty" }, "讀不到資料，請連上網路後重新開啟。"));
  });
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").then(function () {
      if ("Notification" in window && Notification.permission === "granted") registerDaily();
    }).catch(function () {});
  }
  // refresh "today" when the app comes back to the foreground on a new day
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden && viewDate < todayStr()) { viewDate = todayStr(); renderAll(); }
  });
})();
