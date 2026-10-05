package tw.wade.schedule;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.text.SimpleDateFormat;
import java.util.Arrays;
import java.util.Date;
import java.util.Locale;

/**
 * Two safety nets for the user's data:
 *  1. one copy per day inside the app (last 14 days) — "go back to yesterday";
 *  2. a file the user picked once in Google Drive (or anywhere), overwritten with the
 *     latest data at most every 15 minutes — survives a lost or broken phone.
 */
final class Backup {
    private static final String PREFS = "backup";
    private static final long DRIVE_EVERY_MS = 15 * 60 * 1000L;
    private static final int KEEP_DAYS = 14;

    static SharedPreferences prefs(Context c) { return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

    private static File dir(Context c) {
        File d = new File(c.getFilesDir(), "backups");
        if (!d.exists()) d.mkdirs();
        return d;
    }

    private static String today() { return new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date()); }

    /** Called after every save; cheap. Runs the slow part on a background thread. */
    static void onSaved(final Context ctx, final String json, final boolean force) {
        final Context c = ctx.getApplicationContext();
        new Thread(() -> {
            synchronized (Backup.class) {
                try {
                    // 1) today's local copy
                    try (OutputStream o = new FileOutputStream(new File(dir(c), today() + ".json"))) {
                        o.write(json.getBytes(StandardCharsets.UTF_8));
                    }
                    File[] all = dir(c).listFiles();
                    if (all != null && all.length > KEEP_DAYS) {
                        Arrays.sort(all, (a, b) -> a.getName().compareTo(b.getName()));
                        for (int i = 0; i < all.length - KEEP_DAYS; i++) all[i].delete();
                    }
                } catch (Exception ignored) { }
                // 2) the cloud file
                SharedPreferences p = prefs(c);
                String uri = p.getString("uri", null);
                if (uri == null) return;
                long now = System.currentTimeMillis();
                if (!force && now - p.getLong("last", 0) < DRIVE_EVERY_MS) return;
                try (OutputStream o = c.getContentResolver().openOutputStream(Uri.parse(uri), "wt")) {
                    if (o == null) throw new Exception("打不開備份檔");
                    o.write(json.getBytes(StandardCharsets.UTF_8));
                    p.edit().putLong("last", now).remove("error").apply();
                } catch (Exception e) {
                    p.edit().putString("error", e.getClass().getSimpleName() + (e.getMessage() == null ? "" : "：" + e.getMessage())).apply();
                }
            }
        }).start();
    }

    static void setTarget(Context c, Uri uri, String name) {
        prefs(c).edit().putString("uri", uri.toString()).putString("name", name == null ? "" : name).remove("error").putLong("last", 0).apply();
    }

    static void clearTarget(Context c) { prefs(c).edit().remove("uri").remove("name").remove("error").remove("last").apply(); }

    static String status(Context c) {
        try {
            SharedPreferences p = prefs(c);
            JSONObject o = new JSONObject();
            o.put("target", p.getString("uri", null) != null);
            o.put("name", p.getString("name", ""));
            o.put("last", p.getLong("last", 0));
            o.put("error", p.getString("error", ""));
            JSONArray days = new JSONArray();
            File[] all = dir(c).listFiles();
            if (all != null) {
                Arrays.sort(all, (a, b) -> b.getName().compareTo(a.getName()));
                for (File f : all) days.put(f.getName().replace(".json", ""));
            }
            o.put("days", days);
            return o.toString();
        } catch (Exception e) {
            return "{}";
        }
    }

    /** The saved copy of one day, or null. */
    static String load(Context c, String day) {
        try {
            if (day == null || !day.matches("\\d{4}-\\d{2}-\\d{2}")) return null;
            File f = new File(dir(c), day + ".json");
            return f.exists() ? new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8) : null;
        } catch (Exception e) {
            return null;
        }
    }

    private Backup() {}
}
