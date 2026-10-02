package tw.wade.schedule;

import android.content.Context;

/** Keeps a copy of the app's data where the home-screen widget can read it. */
final class Store {
    private static final String PREFS = "sched";
    private static final String KEY = "data";

    static void save(Context c, String json) {
        c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, json).commit();
        ItemReminder.reschedule(c);   // reminders follow every change
    }

    static String load(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null);
    }

    private Store() {}
}
