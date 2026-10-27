package tw.wade.schedule;

import org.json.JSONObject;

/** Days off in YunTech's 115-1 calendar (same list as SCHOOL in app.js): no classes on these days. */
final class SchoolCalendar {
    private static final String[][] OFF = {
        {"2026-09-25", "2026-09-25"}, {"2026-09-28", "2026-09-28"},
        {"2026-10-09", "2026-10-10"}, {"2026-10-25", "2026-10-26"},
        {"2027-01-01", "2027-01-01"}, {"2027-01-11", "2027-02-21"}
    };

    static boolean isOff(String date) {
        for (String[] r : OFF) if (date.compareTo(r[0]) >= 0 && date.compareTo(r[1]) <= 0) return true;
        return false;
    }

    /** Classes (課程) are skipped on days off; any fixed item can also be paused for some dates. */
    static boolean skipClass(JSONObject c, String date) {
        String k = c.optString("kind");
        if ((k.isEmpty() || "課程".equals(k)) && isOff(date)) return true;
        org.json.JSONArray p = c.optJSONArray("pauses");
        for (int i = 0; p != null && i < p.length(); i++) {
            org.json.JSONArray r = p.optJSONArray(i);
            if (r != null && date.compareTo(r.optString(0)) >= 0 && date.compareTo(r.optString(1)) <= 0) return true;
        }
        return false;
    }

    private SchoolCalendar() {}
}
