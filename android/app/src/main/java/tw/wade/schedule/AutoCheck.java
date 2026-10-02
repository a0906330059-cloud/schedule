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
 * Ticks today's runs from Strava (only when the full planned distance is reached)
 * and the EPOP habit from Android's screen-time stats.
 */
final class AutoCheck {
    static final String EPOP_PKG = "kr.epopsoft.word";
    static final String REDIRECT = "wadeschedule://localhost/strava";
    private static final String PREFS = "strava";

    // ---------- Strava account ----------
    static SharedPreferences prefs(Context c) { return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

    static boolean stravaConnected(Context c) { return prefs(c).getString("refresh", null) != null; }

    static void saveClient(Context c, String id, String secret) {
        prefs(c).edit().putString("client_id", id.trim()).putString("client_secret", secret.trim()).apply();
    }

    static String authorizeUrl(Context c) {
        return "https://www.strava.com/oauth/mobile/authorize?client_id=" + enc(prefs(c).getString("client_id", ""))
                + "&redirect_uri=" + enc(REDIRECT) + "&response_type=code&approval_prompt=auto&scope=activity:read_all";
    }

    /** Swaps the one-time code from Strava's sign-in page for long-lived tokens. */
    static boolean exchangeCode(Context c, String code) {
        try {
            SharedPreferences p = prefs(c);
            JSONObject r = post("https://www.strava.com/oauth/token",
                    "client_id=" + enc(p.getString("client_id", "")) + "&client_secret=" + enc(p.getString("client_secret", ""))
                            + "&code=" + enc(code) + "&grant_type=authorization_code");
            storeTokens(c, r);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    static void disconnect(Context c) {
        prefs(c).edit().remove("access").remove("refresh").remove("expires").apply();
    }

    private static void storeTokens(Context c, JSONObject r) throws Exception {
        prefs(c).edit()
                .putString("access", r.getString("access_token"))
                .putString("refresh", r.getString("refresh_token"))
                .putLong("expires", r.getLong("expires_at"))
                .apply();
    }

    private static String accessToken(Context c) throws Exception {
        SharedPreferences p = prefs(c);
        if (p.getLong("expires", 0) - 120 > System.currentTimeMillis() / 1000) return p.getString("access", null);
        JSONObject r = post("https://www.strava.com/oauth/token",
                "client_id=" + enc(p.getString("client_id", "")) + "&client_secret=" + enc(p.getString("client_secret", ""))
                        + "&refresh_token=" + enc(p.getString("refresh", "")) + "&grant_type=refresh_token");
        storeTokens(c, r);
        return r.getString("access_token");
    }

    /** Kilometres run today according to Strava, or -1 if unknown. */
    static double runKmToday(Context c) {
        if (!stravaConnected(c)) return -1;
        try {
            long after = startOfDay().getTimeInMillis() / 1000;
            HttpURLConnection con = (HttpURLConnection) new URL("https://www.strava.com/api/v3/athlete/activities?per_page=50&after=" + after).openConnection();
            con.setRequestProperty("Authorization", "Bearer " + accessToken(c));
            con.setConnectTimeout(10000); con.setReadTimeout(10000);
            if (con.getResponseCode() != 200) return -1;
            JSONArray acts = new JSONArray(read(con.getInputStream()));
            double m = 0;
            for (int i = 0; i < acts.length(); i++) {
                JSONObject a = acts.getJSONObject(i);
                String type = a.optString("sport_type", a.optString("type"));
                if (type.contains("Run")) m += a.optDouble("distance", 0);
            }
            return m / 1000.0;
        } catch (Exception e) {
            return -1;
        }
    }

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
            data.put("auto", auto);

            if (km >= 0) {
                JSONArray tasks = data.optJSONArray("tasks");
                for (int i = 0; tasks != null && i < tasks.length(); i++) {
                    JSONObject t = tasks.getJSONObject(i);
                    double goal = t.optDouble("goalKm", 0);
                    if (today.equals(t.optString("date")) && goal > 0 && km >= goal) t.put("done", true);
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

    private static String enc(String s) {
        try { return URLEncoder.encode(s == null ? "" : s, "UTF-8"); } catch (Exception e) { return ""; }
    }

    private static JSONObject post(String url, String body) throws Exception {
        HttpURLConnection con = (HttpURLConnection) new URL(url).openConnection();
        con.setRequestMethod("POST");
        con.setDoOutput(true);
        con.setConnectTimeout(10000); con.setReadTimeout(10000);
        con.setRequestProperty("Content-Type", "application/x-www-form-urlencoded");
        try (OutputStream o = con.getOutputStream()) { o.write(body.getBytes(StandardCharsets.UTF_8)); }
        if (con.getResponseCode() != 200) throw new Exception("HTTP " + con.getResponseCode());
        return new JSONObject(read(con.getInputStream()));
    }

    private static String read(InputStream in) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        in.close();
        return out.toString("UTF-8");
    }

    private AutoCheck() {}
}
