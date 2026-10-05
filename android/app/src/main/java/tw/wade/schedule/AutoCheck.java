package tw.wade.schedule;

import android.app.AppOpsManager;
import android.app.usage.UsageStats;
import android.app.usage.UsageStatsManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Process;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Locale;
import java.util.Map;

/**
 * Ticks today's runs from Health Connect (only when the full planned distance is reached)
 * and the EPOP habit from Android's screen-time stats.
 */
final class AutoCheck {
    static final String EPOP_PKG = "kr.epopsoft.word";
    /** Kilometres run today from Health Connect (Samsung Health), or -1 if unknown. */
    static double runKmToday(Context c) { return HealthRun.runKmToday(c); }

    // ---------- EPOP screen time ----------
    static boolean usageGranted(Context c) {
        AppOpsManager ops = (AppOpsManager) c.getSystemService(Context.APP_OPS_SERVICE);
        int mode = ops.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), c.getPackageName());
        return mode == AppOpsManager.MODE_ALLOWED;
    }

    /** Minutes EPOP was on screen today, or -1 if not allowed. */
    static int epopMinutesToday(Context c) {
        if (!usageGranted(c)) return -1;
        UsageStatsManager usm = (UsageStatsManager) c.getSystemService(Context.USAGE_STATS_SERVICE);
        Map<String, UsageStats> stats = usm.queryAndAggregateUsageStats(startOfDay().getTimeInMillis(), System.currentTimeMillis());
        UsageStats s = stats.get(EPOP_PKG);
        return s == null ? 0 : (int) (s.getTotalTimeInForeground() / 60000);
    }

    // ---------- apply to today's items ----------
    /** Runs the checks and updates the saved data. Call off the main thread. */
    static synchronized void run(Context c) {
        String json = Store.load(c);
        if (json == null) return;
        double km = runKmToday(c);
        int epop = epopMinutesToday(c);
        try {
            JSONObject data = new JSONObject(json);
            String today = new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Calendar.getInstance().getTime());
            JSONObject auto = new JSONObject();
            auto.put("date", today);
            if (km >= 0) auto.put("runKm", Math.round(km * 10) / 10.0);
            if (epop >= 0) auto.put("epopMin", epop);
            auto.put("hcInfo", HealthRun.lastInfo);
            data.put("auto", auto);

            if (km >= 0) {
                JSONArray tasks = data.optJSONArray("tasks");
                if (tasks == null) { tasks = new JSONArray(); data.put("tasks", tasks); }
                double kmR = Math.round(km * 10) / 10.0;
                boolean planned = false;
                JSONObject extra = null;
                for (int i = 0; i < tasks.length(); i++) {
                    JSONObject t = tasks.getJSONObject(i);
                    if (!today.equals(t.optString("date"))) continue;
                    if (("auto-run-" + today).equals(t.optString("id"))) { extra = t; continue; }
                    double goal = t.optDouble("goalKm", 0);
                    if (goal <= 0) continue;
                    planned = true;
                    if (km >= goal) { t.put("done", true); t.put("doneKm", kmR); }
                    else t.remove("doneKm");   // ticked by hand: count the planned distance
                }
                // a run that wasn't on the schedule: log it once it's past the minimum distance
                JSONObject settings0 = data.optJSONObject("settings");
                double minKm = settings0 == null ? 1 : settings0.optDouble("extraRunMin", 1);
                if (!planned && km >= minKm && km > 0) {
                    if (extra == null) {
                        extra = new JSONObject();
                        extra.put("id", "auto-run-" + today); extra.put("kind", "task"); extra.put("date", today);
                        extra.put("cat", "跑步"); extra.put("time", ""); extra.put("note", "沒排在日程上，App 從 Health Connect 自動記錄");
                        tasks.put(extra);
                    }
                    extra.put("title", "額外跑步 " + WidgetService.fmtKm(kmR) + "K");
                    extra.put("goalKm", kmR); extra.put("doneKm", kmR); extra.put("done", true);
                }
            }
            if (epop >= 0) {
                JSONObject settings = data.optJSONObject("settings");
                int need = settings == null ? 10 : settings.optInt("epopMin", 10);
                JSONArray habits = data.optJSONArray("habits");
                for (int i = 0; habits != null && i < habits.length(); i++) {
                    JSONObject h = habits.getJSONObject(i);
                    // three 10-minute sessions a day: the 2nd ticks at 20 min in total, the 3rd at 30
                    if (!"epop".equals(h.optString("link")) || epop < need * Math.max(1, h.optInt("epopSlot", 1))) continue;
                    JSONObject dd = h.optJSONObject("doneDates");
                    if (dd == null) { dd = new JSONObject(); h.put("doneDates", dd); }
                    dd.put(today, true);
                }
            }
            Store.save(c, data.toString());
        } catch (Exception ignored) { }
    }

    // ---------- small helpers ----------
    private static Calendar startOfDay() {
        Calendar cal = Calendar.getInstance();
        cal.set(Calendar.HOUR_OF_DAY, 0); cal.set(Calendar.MINUTE, 0); cal.set(Calendar.SECOND, 0); cal.set(Calendar.MILLISECOND, 0);
        return cal;
    }

    private AutoCheck() {}
}
