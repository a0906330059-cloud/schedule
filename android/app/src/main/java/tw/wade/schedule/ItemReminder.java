package tw.wade.schedule;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;
import java.util.Locale;

/**
 * "Starts in 10 minutes" notifications for each item, plus a weekly review
 * every Sunday at 21:00. Only one alarm is kept: the next thing due.
 */
public class ItemReminder extends BroadcastReceiver {
    static final String CHANNEL = "remind";
    private static final String PREFS = "item-remind";
    // SimpleDateFormat is not thread-safe, so each thread gets its own
    private static final ThreadLocal<SimpleDateFormat> FMT = ThreadLocal.withInitial(() -> new SimpleDateFormat("yyyy-MM-dd", Locale.US));

    private static final class Due {
        final long at; final String title, text; final int id;
        Due(long at, String title, String text, int id) { this.at = at; this.title = title; this.text = text; this.id = id; }
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        final Context c = context.getApplicationContext();
        final PendingResult pending = goAsync();
        new Thread(() -> {
            try { fire(c); } catch (Exception ignored) { } finally { reschedule(c); pending.finish(); }
        }).start();
    }

    /** Call whenever the data changes, on boot, and after each alarm. */
    static synchronized void reschedule(Context c) {
        long now = System.currentTimeMillis();
        Due next = null;
        for (Due d : upcoming(c)) if (d.at > now + 15000 && (next == null || d.at < next.at)) next = d;
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        PendingIntent pi = PendingIntent.getBroadcast(c, 20, new Intent(c, ItemReminder.class),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        am.cancel(pi);
        if (next == null) return;
        boolean exact = Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms();
        if (exact) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next.at, pi);
        else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next.at, pi);
    }

    private static void fire(Context c) throws Exception {
        SharedPreferences p = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        long now = System.currentTimeMillis();
        long last = Math.max(p.getLong("last", now - 10 * 60000L), now - 30 * 60000L);
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        nm.createNotificationChannel(new NotificationChannel(CHANNEL, "事前提醒", NotificationManager.IMPORTANCE_HIGH));
        PendingIntent open = PendingIntent.getActivity(c, 21, new Intent(c, MainActivity.class), PendingIntent.FLAG_IMMUTABLE);
        for (Due d : upcoming(c)) {
            if (d.at <= last || d.at > now + 15000) continue;
            nm.notify(d.id, new Notification.Builder(c, CHANNEL)
                    .setSmallIcon(R.drawable.ic_notify)
                    .setContentTitle(d.title)
                    .setContentText(d.text)
                    .setStyle(new Notification.BigTextStyle().bigText(d.text))
                    .setContentIntent(open)
                    .setAutoCancel(true)
                    .build());
        }
        p.edit().putLong("last", now + 15000).apply();
    }

    /** Everything that should ring today or tomorrow. */
    private static List<Due> upcoming(Context c) {
        List<Due> out = new ArrayList<>();
        String json = Store.load(c);
        if (json == null) return out;
        try {
            JSONObject data = new JSONObject(json);
            JSONObject s = data.optJSONObject("settings");
            int defClass = s == null ? 10 : s.optInt("remindClass", 10);
            int defOther = s == null ? 10 : s.optInt("remindOther", 10);   // daily habits
            int defTask = s == null ? BOTH_DAYS : s.optInt("remindTask", BOTH_DAYS); // events & tasks
            JSONArray terms = data.optJSONArray("terms");
            for (int k = 0; k < 2; k++) {
                Calendar day = Calendar.getInstance();
                day.add(Calendar.DAY_OF_MONTH, k);
                String date = FMT.get().format(day.getTime());
                int dow = day.get(Calendar.DAY_OF_WEEK) - 1;

                JSONArray classes = data.optJSONArray("classes");
                for (int i = 0; classes != null && i < classes.length(); i++) {
                    JSONObject o = classes.getJSONObject(i);
                    if (o.optInt("day", -1) != dow || !WidgetService.termCovers(terms, o.optString("termId"), date)) continue;
                    add(out, date, o.optString("start"), o.has("remind") ? o.optInt("remind") : defClass,
                            o.optString("name"), o.optString("room"), o.optString("id") + date);
                }
                JSONArray habits = data.optJSONArray("habits");
                for (int i = 0; habits != null && i < habits.length(); i++) {
                    JSONObject h = habits.getJSONObject(i);
                    JSONArray days = h.optJSONArray("days");
                    boolean on = false;
                    for (int d = 0; days != null && d < days.length(); d++) if (days.optInt(d) == dow) on = true;
                    String start = h.optString("start"), end = h.optString("end");
                    JSONObject dd = h.optJSONObject("doneDates");
                    if (!on || date.compareTo(start) < 0 || (!end.isEmpty() && date.compareTo(end) > 0) || (dd != null && dd.optBoolean(date))) continue;
                    int hr = h.has("remind") ? h.optInt("remind") : defOther;
                    if (hr == BOTH_DAYS || hr >= DAY) hr = defOther;   // "days before" makes no sense for something daily
                    add(out, date, h.optString("time"), hr,
                            h.optString("title"), h.optString("note"), h.optString("id") + date);
                }
                // weekly review: Sunday 21:00
                if (dow == 0) {
                    Calendar at = (Calendar) day.clone();
                    at.set(Calendar.HOUR_OF_DAY, 21); at.set(Calendar.MINUTE, 0); at.set(Calendar.SECOND, 0); at.set(Calendar.MILLISECOND, 0);
                    out.add(new Due(at.getTimeInMillis(), "本週回顧", weekly(data, day), 777));
                }
            }
            // events & tasks: up to 3 days ahead, reminded the evening before / 3 days before
            String today = FMT.get().format(Calendar.getInstance().getTime());
            Calendar lim = Calendar.getInstance();
            lim.add(Calendar.DAY_OF_MONTH, 4);
            String last = FMT.get().format(lim.getTime());
            JSONArray tasks = data.optJSONArray("tasks");
            for (int i = 0; tasks != null && i < tasks.length(); i++) {
                JSONObject o = tasks.getJSONObject(i);
                String date = o.optString("date");
                if (o.optBoolean("done") || date.compareTo(today) < 0 || date.compareTo(last) > 0) continue;
                int r = o.has("remind") ? o.optInt("remind") : defTask;
                String title = o.optString("title"), time = o.optString("time"), key = o.optString("id");
                if (r == BOTH_DAYS) { addDays(out, date, 3, time, title, key); addDays(out, date, 1, time, title, key); }
                else if (r >= DAY && r % DAY == 0) addDays(out, date, r / DAY, time, title, key);
                else add(out, date, time, r, title, o.optString("note"), key);
            }
        } catch (Exception ignored) { }
        return out;
    }

    static final int DAY = 1440, BOTH_DAYS = -31;
    private static final String WD = "日一二三四五六";

    /** "n days before" reminders ring at 20:00 that evening. */
    private static void addDays(List<Due> out, String date, int n, String time, String title, String key) {
        try {
            Calendar d = Calendar.getInstance();
            d.setTime(FMT.get().parse(date));
            String when = (d.get(Calendar.MONTH) + 1) + "/" + d.get(Calendar.DAY_OF_MONTH) + " 週" + WD.charAt(d.get(Calendar.DAY_OF_WEEK) - 1)
                    + (time != null && time.matches("\\d\\d:\\d\\d") ? " " + time : "");
            Calendar at = (Calendar) d.clone();
            at.add(Calendar.DAY_OF_MONTH, -n);
            at.set(Calendar.HOUR_OF_DAY, 20); at.set(Calendar.MINUTE, 0); at.set(Calendar.SECOND, 0); at.set(Calendar.MILLISECOND, 0);
            String text = (n == 1 ? "明天" : n + " 天後") + "（" + when + "）";
            out.add(new Due(at.getTimeInMillis(), title, text, 1000 + Math.abs((key + "d" + n).hashCode() % 100000)));
        } catch (Exception ignored) { }
    }

    private static void add(List<Due> out, String date, String time, int before, String title, String sub, String key) {
        if (before < 0 || time == null || !time.matches("\\d\\d:\\d\\d")) return;
        try {
            Calendar at = Calendar.getInstance();
            at.setTime(FMT.get().parse(date));
            at.set(Calendar.HOUR_OF_DAY, Integer.parseInt(time.substring(0, 2)));
            at.set(Calendar.MINUTE, Integer.parseInt(time.substring(3, 5)));
            at.add(Calendar.MINUTE, -before);
            String when = before == 0 ? "現在開始" : (before >= 60 ? (before / 60) + " 小時後" : before + " 分鐘後") + "開始（" + time + "）";
            out.add(new Due(at.getTimeInMillis(), title, when + (sub == null || sub.isEmpty() ? "" : "\n" + sub), 1000 + Math.abs(key.hashCode() % 100000)));
        } catch (Exception ignored) { }
    }

    /** Same numbers as the app's weekly review card. */
    private static String weekly(JSONObject data, Calendar sunday) throws Exception {
        Calendar mon = (Calendar) sunday.clone();
        mon.add(Calendar.DAY_OF_MONTH, -6);
        String from = FMT.get().format(mon.getTime()), to = FMT.get().format(sunday.getTime());
        int done = 0, total = 0; double km = 0;
        JSONArray tasks = data.optJSONArray("tasks");
        for (int i = 0; tasks != null && i < tasks.length(); i++) {
            JSONObject t = tasks.getJSONObject(i);
            String d = t.optString("date");
            boolean event = t.has("kind") ? "event".equals(t.optString("kind")) : t.optBoolean("milestone");
            if (event || d.compareTo(from) < 0 || d.compareTo(to) > 0) continue;
            total++;
            if (t.optBoolean("done")) { done++; km += t.optDouble("doneKm", t.optDouble("goalKm", 0)); }
        }
        JSONArray habits = data.optJSONArray("habits");
        for (int i = 0; habits != null && i < habits.length(); i++) {
            JSONObject h = habits.getJSONObject(i);
            JSONArray days = h.optJSONArray("days");
            JSONObject dd = h.optJSONObject("doneDates");
            Calendar d = (Calendar) mon.clone();
            for (int k = 0; k < 7; k++, d.add(Calendar.DAY_OF_MONTH, 1)) {
                String ds = FMT.get().format(d.getTime());
                int dow = d.get(Calendar.DAY_OF_WEEK) - 1;
                boolean on = false;
                for (int j = 0; days != null && j < days.length(); j++) if (days.optInt(j) == dow) on = true;
                if (!on || ds.compareTo(h.optString("start")) < 0) continue;
                total++;
                if (dd != null && dd.optBoolean(ds)) done++;
            }
        }
        int pct = total == 0 ? 0 : Math.round(done * 100f / total);
        return "這週完成 " + done + "/" + total + " 件（" + pct + "%），跑了 " + (Math.round(km * 10) / 10.0) + " 公里。\n打開 App 的「接下來」看完整回顧。";
    }
}
