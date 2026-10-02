// Shared by the page and the service worker: builds today's reminder text.
(function (g) {
  function pad(n) { return String(n).padStart(2, "0"); }
  function fmt(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  var WD = ["日", "一", "二", "三", "四", "五", "六"];

  g.buildSummary = function (data, now) {
    now = now || new Date();
    var today = fmt(now), dow = now.getDay();
    var lines = [];
    var terms = data.terms && data.terms.length ? data.terms : [{ id: "", start: "", end: "" }];
    function termOf(c) { for (var i = 0; i < terms.length; i++) if (terms[i].id === c.termId) return terms[i]; return terms[0]; }
    var cls = (data.classes || []).filter(function (c) { var t = termOf(c); return c.day === dow && (!t.start || today >= t.start) && (!t.end || today <= t.end); })
      .sort(function (a, b) { return a.start.localeCompare(b.start); });
    cls.forEach(function (c) { lines.push(c.start + " " + c.name + (c.room ? "（" + c.room + "）" : "")); });
    var todo = (data.tasks || []).filter(function (t) { return t.date === today && !t.done; })
      .sort(function (a, b) { return (a.time || "99").localeCompare(b.time || "99"); });
    (data.habits || []).forEach(function (h) {
      if (h.days.indexOf(dow) >= 0 && today >= h.start && (!h.end || today <= h.end) && !(h.doneDates && h.doneDates[today])) todo.push(h);
    });
    todo.sort(function (a, b) { return (a.time || "99").localeCompare(b.time || "99"); });
    todo.forEach(function (t) { lines.push((t.time ? t.time + " " : "・") + t.title); });
    var overdue = (data.tasks || []).filter(function (t) { return t.date < today && !t.done && !t.milestone; }).length;
    if (overdue) lines.push("還有 " + overdue + " 件逾期沒打勾");
    var next = (data.tasks || []).filter(function (t) { return t.milestone && t.date >= today; })
      .sort(function (a, b) { return a.date.localeCompare(b.date); })[0];
    if (next) {
      var p = next.date.split("-").map(Number);
      var n = Math.round((new Date(p[0], p[1] - 1, p[2]) - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 864e5);
      lines.push((next.short || next.title) + (n === 0 ? " 就是今天！" : " D-" + n));
    }
    return {
      title: (now.getMonth() + 1) + "/" + now.getDate() + "（" + WD[dow] + "）今天要做的事",
      body: lines.length ? lines.join("\n") : "今天沒有排事情，好好休息。",
      today: today
    };
  };
})(typeof self !== "undefined" ? self : this);
