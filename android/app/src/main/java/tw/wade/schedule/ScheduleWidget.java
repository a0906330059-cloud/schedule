package tw.wade.schedule;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Locale;

/** Home-screen widget: today's date, a + button for quick add, and today's list. */
public class ScheduleWidget extends AppWidgetProvider {
    private static final String WEEKDAYS = "日一二三四五六";
    static final String ACTION_TOGGLE = "tw.wade.schedule.TOGGLE";
    static final String EXTRA_TYPE = "type";
    static final String EXTRA_ID = "id";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (ACTION_TOGGLE.equals(intent.getAction())) {
            toggle(context, intent.getStringExtra(EXTRA_TYPE), intent.getStringExtra(EXTRA_ID));
            refreshAll(context);
            return;
        }
        super.onReceive(context, intent);
    }

    /** Ticks or unticks one of today's items, the same way the app does. */
    static void toggle(Context c, String type, String id) {
        String json = Store.load(c);
        if (json == null || type == null || id == null || id.isEmpty() || "class".equals(type)) return;
        try {
            JSONObject data = new JSONObject(json);
            String today = new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Calendar.getInstance().getTime());
            String key = "task".equals(type) ? "tasks" : "habit".equals(type) ? "habits" : "classes";
            JSONArray arr = data.optJSONArray(key);
            for (int i = 0; arr != null && i < arr.length(); i++) {
                JSONObject o = arr.getJSONObject(i);
                if (!id.equals(o.optString("id"))) continue;
                if ("task".equals(type)) {
                    o.put("done", !o.optBoolean("done"));
                } else {
                    JSONObject dd = o.optJSONObject("doneDates");
                    if (dd == null) { dd = new JSONObject(); o.put("doneDates", dd); }
                    if (dd.optBoolean(today)) dd.remove(today); else dd.put(today, true);
                }
                break;
            }
            Store.save(c, data.toString());
        } catch (Exception ignored) { }
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        for (int id : ids) update(context, manager, id);
        // every ~30 min: look at Strava / EPOP in the background, then redraw
        final PendingResult pending = goAsync();
        final Context app = context.getApplicationContext();
        new Thread(() -> {
            try { AutoCheck.run(app); refreshAll(app); } finally { pending.finish(); }
        }).start();
    }

    static void update(Context c, AppWidgetManager m, int id) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget);
        Calendar cal = Calendar.getInstance();
        v.setTextViewText(R.id.w_date, (cal.get(Calendar.MONTH) + 1) + "/" + cal.get(Calendar.DAY_OF_MONTH));
        v.setTextViewText(R.id.w_dow, "週" + WEEKDAYS.charAt(cal.get(Calendar.DAY_OF_WEEK) - 1));

        Intent svc = new Intent(c, WidgetService.class);
        svc.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id);
        svc.setData(Uri.parse(svc.toUri(Intent.URI_INTENT_SCHEME)));
        v.setRemoteAdapter(R.id.w_list, svc);
        v.setEmptyView(R.id.w_list, R.id.w_empty);

        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        // tapping anywhere (background, date, empty space) opens the calendar
        Intent openCal = new Intent(c, MainActivity.class).setAction("tw.wade.schedule.OPEN_CAL")
                .putExtra(MainActivity.EXTRA_VIEW, "cal");
        PendingIntent open = PendingIntent.getActivity(c, 0, openCal, flags);
        v.setOnClickPendingIntent(R.id.w_root, open);
        v.setOnClickPendingIntent(R.id.w_header, open);
        v.setOnClickPendingIntent(R.id.w_empty, open);

        Intent add = new Intent(c, MainActivity.class)
                .setAction("tw.wade.schedule.QUICK_ADD")
                .putExtra(MainActivity.EXTRA_QUICK_ADD, true);
        v.setOnClickPendingIntent(R.id.w_add, PendingIntent.getActivity(c, 1, add, flags));

        // list rows: row → open the app, checkbox → tick (both via WidgetActionActivity)
        Intent hop = new Intent(c, WidgetActionActivity.class);
        PendingIntent template = PendingIntent.getActivity(c, 2, hop,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE);
        v.setPendingIntentTemplate(R.id.w_list, template);

        m.updateAppWidget(id, v);
        m.notifyAppWidgetViewDataChanged(id, R.id.w_list);
    }

    static void refreshAll(Context c) {
        AppWidgetManager m = AppWidgetManager.getInstance(c);
        int[] ids = m.getAppWidgetIds(new ComponentName(c, ScheduleWidget.class));
        for (int id : ids) update(c, m, id);
    }
}
