package tw.wade.schedule;

import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.view.View;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collections;
import java.util.List;
import java.util.Locale;

/** Supplies today's classes, events and unfinished tasks to the widget list. */
public class WidgetService extends RemoteViewsService {
    @Override
    public RemoteViewsFactory onGetViewFactory(Intent intent) {
        return new Factory(getApplicationContext());
    }

    private static final class Item {
        final String time, title, type, id; final int color; final boolean event, done; String info = "";
        Item(String time, String title, int color, boolean event, String type, String id, boolean done) {
            this.time = time; this.title = title; this.color = color; this.event = event; this.type = type; this.id = id; this.done = done;
        }
        String sortKey() { return time.isEmpty() ? (event ? "00" : "99") : time; }
    }

    static String fmtKm(double k) { return k == Math.floor(k) ? String.valueOf((int) k) : String.valueOf(k); }

    static int colorFor(String cat) {
        switch (cat == null ? "" : cat) {
            case "課程": return Color.parseColor("#4D82FF");
            case "校隊": return Color.parseColor("#E8EDF5");
            case "作業考試": return Color.parseColor("#FF6B6F");
            case "跑步": return Color.parseColor("#5BB8FF");
            case "英文": return Color.parseColor("#8B96FF");
            case "程式": return Color.parseColor("#93B4FF");
            case "柳丁樹": return Color.parseColor("#94A3B8");
            case "閱讀": return Color.parseColor("#38C6FF");
            case "讀書": return Color.parseColor("#C7D2FE");
            case "社團": return Color.parseColor("#C084FC");
            case "健身": return Color.parseColor("#22D3EE");
            default: return Color.parseColor("#64748B");
        }
    }

    /** A class belongs to a timetable (semester); only show it while that timetable is in effect. */
    static boolean termCovers(JSONArray terms, String termId, String today) {
        if (terms == null || terms.length() == 0) return true;
        JSONObject t = terms.optJSONObject(0);
        for (int i = 0; i < terms.length(); i++) {
            JSONObject x = terms.optJSONObject(i);
            if (x != null && x.optString("id").equals(termId)) { t = x; break; }
        }
        if (t == null) return true;
        String start = t.optString("start"), end = t.optString("end");
        return (start.isEmpty() || today.compareTo(start) >= 0) && (end.isEmpty() || today.compareTo(end) <= 0);
    }

    private static final class Factory implements RemoteViewsFactory {
        private final Context ctx;
        private final List<Item> items = new ArrayList<>();

        Factory(Context ctx) { this.ctx = ctx; }

        @Override public void onCreate() { }
        @Override public void onDestroy() { items.clear(); }
        @Override public int getCount() { return items.size(); }
        @Override public RemoteViews getLoadingView() { return null; }
        @Override public int getViewTypeCount() { return 1; }
        @Override public long getItemId(int position) { return position; }
        @Override public boolean hasStableIds() { return false; }

        @Override
        public void onDataSetChanged() {
            items.clear();
            String json = Store.load(ctx);
            if (json == null) return;
            try {
                JSONObject data = new JSONObject(json);
                Calendar cal = Calendar.getInstance();
                String today = new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(cal.getTime());
                int dow = cal.get(Calendar.DAY_OF_WEEK) - 1;

                JSONObject auto = data.optJSONObject("auto");
                if (auto != null && !today.equals(auto.optString("date"))) auto = null;
                JSONObject settings = data.optJSONObject("settings");
                int epopNeed = settings == null ? 10 : settings.optInt("epopMin", 10);
                JSONArray terms = data.optJSONArray("terms");
                JSONArray classes = data.optJSONArray("classes");
                for (int i = 0; classes != null && i < classes.length(); i++) {
                    JSONObject c = classes.getJSONObject(i);
                    if (c.optInt("day", -1) != dow || !termCovers(terms, c.optString("termId"), today)) continue;
                    // fixed schedule items (classes, team practice) are shown but never ticked
                    items.add(new Item(c.optString("start"), c.optString("name"), colorFor(c.optString("kind")), true,
                            "class", "", false));
                }
                JSONArray tasks = data.optJSONArray("tasks");
                for (int i = 0; tasks != null && i < tasks.length(); i++) {
                    JSONObject t = tasks.getJSONObject(i);
                    if (!today.equals(t.optString("date"))) continue;
                    boolean event = t.has("kind") ? "event".equals(t.optString("kind")) : t.optBoolean("milestone");
                    Item ti = new Item(t.optString("time"), t.optString("title"), colorFor(t.optString("cat")), event,
                            "task", t.optString("id"), t.optBoolean("done"));
                    if (auto != null && t.optDouble("goalKm", 0) > 0 && auto.has("runKm"))
                        ti.info = "Strava " + auto.optDouble("runKm") + "/" + fmtKm(t.optDouble("goalKm")) + "K";
                    items.add(ti);
                }
                JSONArray habits = data.optJSONArray("habits");
                for (int i = 0; habits != null && i < habits.length(); i++) {
                    JSONObject h = habits.getJSONObject(i);
                    JSONArray days = h.optJSONArray("days");
                    boolean on = false;
                    for (int d = 0; days != null && d < days.length(); d++) if (days.optInt(d) == dow) on = true;
                    String start = h.optString("start"), end = h.optString("end");
                    if (!on || today.compareTo(start) < 0 || (!end.isEmpty() && today.compareTo(end) > 0)) continue;
                    JSONObject done = h.optJSONObject("doneDates");
                    Item hi = new Item(h.optString("time"), h.optString("title"), colorFor(h.optString("cat")), false,
                            "habit", h.optString("id"), done != null && done.optBoolean(today));
                    if (auto != null && "epop".equals(h.optString("link")) && auto.has("epopMin"))
                        hi.info = "已用 " + auto.optInt("epopMin") + "/" + (epopNeed * Math.max(1, h.optInt("epopSlot", 1))) + " 分";
                    items.add(hi);
                }
                Collections.sort(items, (a, b) -> a.sortKey().compareTo(b.sortKey()));
            } catch (Exception ignored) { }
        }

        @Override
        public RemoteViews getViewAt(int position) {
            Item it = items.get(position);
            RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_item);
            v.setTextViewText(R.id.i_time, it.time.isEmpty() ? (it.event ? "整天" : "—") : it.time);
            v.setTextViewText(R.id.i_title, it.title.replaceFirst("^(Python|柳丁樹)：", ""));
            v.setViewVisibility(R.id.i_bar, it.event ? View.VISIBLE : View.GONE);
            v.setViewVisibility(R.id.i_dot, it.event ? View.GONE : View.VISIBLE);
            v.setInt(R.id.i_bar, "setColorFilter", it.color);
            v.setInt(R.id.i_dot, "setColorFilter", it.color);
            v.setTextViewText(R.id.i_info, it.info);
            v.setViewVisibility(R.id.i_info, it.info.isEmpty() ? View.GONE : View.VISIBLE);
            boolean fixed = "class".equals(it.type);
            v.setViewVisibility(R.id.i_check, fixed ? View.GONE : View.VISIBLE);
            v.setImageViewResource(R.id.i_check, it.done ? R.drawable.box_on : R.drawable.box_off);
            v.setTextColor(R.id.i_title, it.done ? Color.parseColor("#5B6474") : Color.WHITE);
            Intent fill = new Intent();
            fill.putExtra(ScheduleWidget.EXTRA_TYPE, it.type);
            fill.putExtra(ScheduleWidget.EXTRA_ID, it.id);
            v.setOnClickFillInIntent(R.id.i_root, fill);
            return v;
        }
    }
}
