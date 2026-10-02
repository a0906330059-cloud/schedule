package tw.wade.schedule;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collections;
import java.util.List;
import java.util.Locale;

/** Morning notification: today's plan, the article of the day and a line of encouragement. */
public class DailyReminder extends BroadcastReceiver {
    static final String CHANNEL = "daily";
    private static final String PREFS = "reminder";
    private static final String DAILY_URL = "https://a0906330059-cloud.github.io/schedule/daily.json";
    private static final String REPORT_URL = "https://a0906330059-cloud.github.io/schedule/report.json";

    /** "HH:mm", or empty to turn the reminder off. */
    static void schedule(Context c, String time) {
        c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("time", time == null ? "" : time).apply();
        scheduleNext(c);
    }

    static void scheduleNext(Context c) {
        String time = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("time", "07:30");
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        PendingIntent pi = PendingIntent.getBroadcast(c, 10, new Intent(c, DailyReminder.class).setAction("tw.wade.schedule.DAILY"),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        am.cancel(pi);
        if (time == null || !time.matches("\\d\\d:\\d\\d")) return;
        Calendar next = Calendar.getInstance();
        next.set(Calendar.HOUR_OF_DAY, Integer.parseInt(time.substring(0, 2)));
        next.set(Calendar.MINUTE, Integer.parseInt(time.substring(3, 5)));
        next.set(Calendar.SECOND, 0);
        next.set(Calendar.MILLISECOND, 0);
        if (next.getTimeInMillis() <= System.currentTimeMillis()) next.add(Calendar.DAY_OF_MONTH, 1);
        am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next.getTimeInMillis(), pi);
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        final Context c = context.getApplicationContext();
        if (Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) { scheduleNext(c); ItemReminder.reschedule(c); return; }
        final PendingResult pending = goAsync();
        new Thread(() -> {
            try { AutoCheck.run(c); show(c); ScheduleWidget.refreshAll(c); }
            catch (Exception ignored) { }
            finally { scheduleNext(c); pending.finish(); }
        }).start();
    }

    private static void show(Context c) throws Exception {
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        nm.createNotificationChannel(new NotificationChannel(CHANNEL, "每日提醒", NotificationManager.IMPORTANCE_DEFAULT));

        String json = Store.load(c);
        JSONObject data = json == null ? new JSONObject() : new JSONObject(json);
        Calendar cal = Calendar.getInstance();
        String today = new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(cal.getTime());
        int dow = cal.get(Calendar.DAY_OF_WEEK) - 1;

        List<String[]> lines = new ArrayList<>();
        JSONArray terms = data.optJSONArray("terms");
        JSONArray classes = data.optJSONArray("classes");
        for (int i = 0; classes != null && i < classes.length(); i++) {
            JSONObject o = classes.getJSONObject(i);
            if (o.optInt("day", -1) == dow && WidgetService.termCovers(terms, o.optString("termId"), today))
                lines.add(new String[]{o.optString("start"), o.optString("name")});
        }
        JSONArray tasks = data.optJSONArray("tasks");
        for (int i = 0; tasks != null && i < tasks.length(); i++) {
            JSONObject o = tasks.getJSONObject(i);
            if (today.equals(o.optString("date")) && !o.optBoolean("done")) lines.add(new String[]{o.optString("time"), o.optString("title")});
        }
        JSONArray habits = data.optJSONArray("habits");
        for (int i = 0; habits != null && i < habits.length(); i++) {
            JSONObject h = habits.getJSONObject(i);
            JSONArray days = h.optJSONArray("days");
            boolean on = false;
            for (int d = 0; days != null && d < days.length(); d++) if (days.optInt(d) == dow) on = true;
            String start = h.optString("start"), end = h.optString("end");
            if (on && today.compareTo(start) >= 0 && (end.isEmpty() || today.compareTo(end) <= 0))
                lines.add(new String[]{h.optString("time"), h.optString("title")});
        }
        Collections.sort(lines, (a, b) -> (a[0].isEmpty() ? "99" : a[0]).compareTo(b[0].isEmpty() ? "99" : b[0]));

        StringBuilder body = new StringBuilder();
        String quote = quoteFor(c, data);
        if (!quote.isEmpty()) body.append("💪 ").append(quote).append("\n\n");
        for (int i = 0; i < lines.size() && i < 6; i++)
            body.append(lines.get(i)[0].isEmpty() ? "・" : lines.get(i)[0] + " ").append(lines.get(i)[1]).append("\n");
        if (lines.size() > 6) body.append("…還有 ").append(lines.size() - 6).append(" 件\n");
        String article = articleTitle();
        if (!article.isEmpty()) body.append("\n📰 ").append(article);

        String title = (cal.get(Calendar.MONTH) + 1) + "/" + cal.get(Calendar.DAY_OF_MONTH) + " 今天有 " + lines.size() + " 件事";
        PendingIntent open = PendingIntent.getActivity(c, 11, new Intent(c, MainActivity.class), PendingIntent.FLAG_IMMUTABLE);
        Notification n = new Notification.Builder(c, CHANNEL)
                .setSmallIcon(R.drawable.ic_notify)
                .setContentTitle(title)
                .setContentText(quote.isEmpty() ? "打開看看今天的安排" : quote)
                .setStyle(new Notification.BigTextStyle().bigText(body.toString().trim()))
                .setContentIntent(open)
                .setAutoCancel(true)
                .build();
        nm.notify(1, n);
    }

    /** Same rotation as the app: the user's own lines first, otherwise the built-in list. */
    static String quoteFor(Context c, JSONObject data) {
        List<String> list = new ArrayList<>();
        JSONObject s = data.optJSONObject("settings");
        if (s != null) for (String line : s.optString("quotes", "").split("\n")) if (!line.trim().isEmpty()) list.add(line.trim());
        if (list.isEmpty()) {
            try (InputStream in = c.getAssets().open("www/quotes.json")) {
                JSONArray arr = new JSONArray(read(in));
                for (int i = 0; i < arr.length(); i++) list.add(arr.getString(i));
            } catch (Exception ignored) { }
        }
        if (list.isEmpty()) return "";
        Calendar mid = Calendar.getInstance();
        mid.set(Calendar.HOUR_OF_DAY, 0); mid.set(Calendar.MINUTE, 0); mid.set(Calendar.SECOND, 0); mid.set(Calendar.MILLISECOND, 0);
        long n = Math.floorDiv(mid.getTimeInMillis(), 86400000L);
        return list.get((int) Math.floorMod(n, (long) list.size()));
    }

    private static String articleTitle() {
        try {
            HttpURLConnection rc = (HttpURLConnection) new URL(REPORT_URL + "?t=" + System.currentTimeMillis()).openConnection();
            rc.setConnectTimeout(8000); rc.setReadTimeout(8000);
            JSONObject r = new JSONObject(read(rc.getInputStream()));
            String today = new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Calendar.getInstance().getTime());
            if (today.equals(r.optString("date")) && !r.optString("title").isEmpty())
                return "今日報告（" + r.optString("topic") + "）：" + r.optString("title");
        } catch (Exception ignored) { }
        try {
            HttpURLConnection con = (HttpURLConnection) new URL(DAILY_URL + "?t=" + System.currentTimeMillis()).openConnection();
            con.setConnectTimeout(8000); con.setReadTimeout(8000);
            JSONObject d = new JSONObject(read(con.getInputStream()));
            JSONArray a = d.optJSONArray("articles");
            if (a == null || a.length() == 0) return "";
            return "今日文章（" + d.optString("topic") + "）：" + a.getJSONObject(0).optString("title");
        } catch (Exception e) {
            return "";
        }
    }

    private static String read(InputStream in) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int k;
        while ((k = in.read(buf)) > 0) out.write(buf, 0, k);
        return out.toString("UTF-8");
    }
}
