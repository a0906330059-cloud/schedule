package tw.wade.schedule;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * Small widget for Claude's daily report: the headline plus a red "1" badge
 * until the report has been opened in the app. Tapping opens the Report tab.
 */
public class ReportWidget extends AppWidgetProvider {
    private static final String PREFS = "report";
    private static final String URL_REPORT = "https://a0906330059-cloud.github.io/schedule/report.json";

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        refreshAll(context);
        // look for a new report in the background (every ~30 minutes)
        final PendingResult pending = goAsync();
        final Context app = context.getApplicationContext();
        new Thread(() -> {
            try { fetch(app); refreshAll(app); } finally { pending.finish(); }
        }).start();
    }

    static void remember(Context c, String date, String title) {
        if (date == null || title == null || date.isEmpty()) return;
        c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putString("date", date).putString("title", title).apply();
    }

    private static void fetch(Context c) {
        HttpURLConnection con = null;
        try {
            con = (HttpURLConnection) new URL(URL_REPORT + "?t=" + System.currentTimeMillis()).openConnection();
            con.setConnectTimeout(8000);
            con.setReadTimeout(8000);
            con.setUseCaches(false);
            if (con.getResponseCode() != 200) return;
            try (InputStream in = con.getInputStream(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                byte[] buf = new byte[8192];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                JSONObject r = new JSONObject(new String(out.toByteArray(), StandardCharsets.UTF_8));
                remember(c, r.optString("date"), r.optString("title"));
            }
        } catch (Exception ignored) {
        } finally {
            if (con != null) con.disconnect();
        }
    }

    /** The date of the last report opened in the app (saved by the page as settings.readReport). */
    private static String readDate(Context c) {
        try {
            String json = Store.load(c);
            if (json == null) return "";
            JSONObject s = new JSONObject(json).optJSONObject("settings");
            return s == null ? "" : s.optString("readReport", "");
        } catch (Exception e) {
            return "";
        }
    }

    static void refreshAll(Context c) {
        AppWidgetManager m = AppWidgetManager.getInstance(c);
        int[] ids = m.getAppWidgetIds(new ComponentName(c, ReportWidget.class));
        if (ids.length == 0) return;

        SharedPreferences p = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String date = p.getString("date", ""), title = p.getString("title", "");
        String today = new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
        boolean fresh = today.equals(date) && !title.isEmpty();
        boolean unread = fresh && !date.equals(readDate(c));

        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_report);
        v.setTextViewText(R.id.r_tag, fresh ? (unread ? "今日報告・還沒看" : "今日報告・已看完") : "今日報告");
        v.setTextViewText(R.id.r_title, fresh ? title : "今天的報告還沒準備好，大約 7:30 會好");
        v.setTextColor(R.id.r_title, fresh && unread ? 0xFFFFFFFF : 0xFF8D97A8);
        v.setViewVisibility(R.id.r_badge, unread ? View.VISIBLE : View.GONE);

        Intent open = new Intent(c, MainActivity.class).setAction("tw.wade.schedule.OPEN_REPORT")
                .putExtra(MainActivity.EXTRA_VIEW, "report");
        v.setOnClickPendingIntent(R.id.r_root, PendingIntent.getActivity(c, 30, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        for (int id : ids) m.updateAppWidget(id, v);
    }
}
