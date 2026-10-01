importScripts("summary.js");

var CACHE = "sched-app-v1";
var ASSETS = ["./", "index.html", "app.js", "summary.js", "seed.json", "manifest.json", "icon-192.png", "icon-512.png"];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); }));
  self.skipWaiting();
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE && k !== "sched-data"; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

// Serve from cache, refresh in the background (works offline).
self.addEventListener("fetch", function (e) {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then(function (c) {
    return c.match(e.request, { ignoreSearch: true }).then(function (hit) {
      var net = fetch(e.request).then(function (res) { if (res.ok) c.put(e.request, res.clone()); return res; }).catch(function () { return hit; });
      return hit || net;
    });
  }));
});

// Daily reminder: Chrome fires this roughly once a day for installed apps.
self.addEventListener("periodicsync", function (e) {
  if (e.tag === "daily-summary") e.waitUntil(daily());
});

function daily() {
  return caches.open("sched-data").then(function (c) {
    return c.match("./__data.json").then(function (r) {
      if (!r) return;
      return r.json().then(function (data) {
        var now = new Date();
        if (now.getHours() < 6) return;                  // don't buzz in the middle of the night
        return c.match("./__last.txt").then(function (l) { return l ? l.text() : ""; }).then(function (last) {
          var s = buildSummary(data, now);
          if (last === s.today) return;                  // only once per day
          return self.registration.showNotification(s.title, { body: s.body, icon: "icon-192.png", badge: "icon-192.png", tag: "daily" })
            .then(function () { return c.put("./__last.txt", new Response(s.today)); });
        });
      });
    });
  });
}

self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window" }).then(function (list) {
    for (var i = 0; i < list.length; i++) if ("focus" in list[i]) return list[i].focus();
    return self.clients.openWindow("./");
  }));
});
