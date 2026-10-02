package tw.wade.schedule;

import android.content.Context;
import android.content.pm.PackageManager;
import android.health.connect.HealthConnectException;
import android.health.connect.HealthConnectManager;
import android.health.connect.ReadRecordsRequestUsingFilters;
import android.health.connect.ReadRecordsResponse;
import android.health.connect.TimeInstantRangeFilter;
import android.health.connect.datatypes.DistanceRecord;
import android.health.connect.datatypes.ExerciseSessionRecord;
import android.health.connect.datatypes.ExerciseSessionType;
import android.health.connect.datatypes.Record;
import android.os.Build;
import android.os.OutcomeReceiver;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Today's running distance from Android's Health Connect (Strava, Samsung Health,
 * a watch… whatever writes runs there). Free — no Strava API needed.
 * Uses the built-in Health Connect of Android 14+.
 */
final class HealthRun {
    static final String READ_EXERCISE = "android.permission.health.READ_EXERCISE";
    static final String READ_DISTANCE = "android.permission.health.READ_DISTANCE";
    static final String[] PERMS = { READ_EXERCISE, READ_DISTANCE };

    static boolean available(Context c) {
        return Build.VERSION.SDK_INT >= 34 && c.getSystemService(HealthConnectManager.class) != null;
    }

    static boolean granted(Context c) {
        if (!available(c)) return false;
        for (String p : PERMS) if (c.checkSelfPermission(p) != PackageManager.PERMISSION_GRANTED) return false;
        return true;
    }

    /** What Health Connect showed on the last check — shown in Settings to make problems easy to spot. */
    static String lastInfo = "";

    /** Kilometres run today, or -1 if unknown (no permission, too old Android, app in background…). */
    static double runKmToday(Context c) {
        if (!available(c)) { lastInfo = "這支手機沒有內建 Health Connect"; return -1; }
        if (!granted(c)) { lastInfo = "還沒給日程表讀取 Health Connect 的權限"; return -1; }
        try {
            HealthConnectManager hc = c.getSystemService(HealthConnectManager.class);
            Calendar day = Calendar.getInstance();
            day.set(Calendar.HOUR_OF_DAY, 0); day.set(Calendar.MINUTE, 0); day.set(Calendar.SECOND, 0); day.set(Calendar.MILLISECOND, 0);
            Instant from = Instant.ofEpochMilli(day.getTimeInMillis()), to = Instant.now();

            List<ExerciseSessionRecord> runs = new ArrayList<>();
            List<ExerciseSessionRecord> sessions = read(hc, ExerciseSessionRecord.class, from, to);
            List<DistanceRecord> dist = read(hc, DistanceRecord.class, from, to);
            StringBuilder info = new StringBuilder("Health Connect 今天：運動 " + sessions.size() + " 筆、距離紀錄 " + dist.size() + " 筆");
            for (ExerciseSessionRecord s : sessions) {
                int t = s.getExerciseType();
                boolean run = t == ExerciseSessionType.EXERCISE_SESSION_TYPE_RUNNING || t == ExerciseSessionType.EXERCISE_SESSION_TYPE_RUNNING_TREADMILL;
                if (run) runs.add(s);
                info.append("\n・").append(run ? "跑步" : "運動類型 " + t).append("，來自 ")
                    .append(s.getMetadata().getDataOrigin().getPackageName())
                    .append("，").append(String.format(java.util.Locale.US, "%.2f", metres(s, dist) / 1000)).append(" 公里");
            }
            lastInfo = info.toString();
            if (runs.isEmpty()) return 0;

            // the same run can be saved by two apps (e.g. Strava and Samsung Health):
            // overlapping sessions count once, using the longest distance among them
            runs.sort((a, b) -> a.getStartTime().compareTo(b.getStartTime()));
            double total = 0, groupMax = -1;
            Instant groupEnd = null;
            for (ExerciseSessionRecord s : runs) {
                double m = metres(s, dist);
                if (groupEnd != null && s.getStartTime().isBefore(groupEnd)) {
                    groupMax = Math.max(groupMax, m);
                    if (s.getEndTime().isAfter(groupEnd)) groupEnd = s.getEndTime();
                } else {
                    if (groupMax > 0) total += groupMax;
                    groupMax = m; groupEnd = s.getEndTime();
                }
            }
            if (groupMax > 0) total += groupMax;
            return total / 1000.0;
        } catch (Exception e) {
            lastInfo = "讀 Health Connect 失敗：" + e.getClass().getSimpleName() + " " + e.getMessage();
            return -1;
        }
    }

    /** Distance inside one session, preferring records from the same app that saved the session. */
    private static double metres(ExerciseSessionRecord s, List<DistanceRecord> all) {
        String pkg = s.getMetadata().getDataOrigin().getPackageName();
        double same = 0, any = 0;
        for (DistanceRecord d : all) {
            if (d.getEndTime().isBefore(s.getStartTime()) || d.getStartTime().isAfter(s.getEndTime())) continue;
            double m = d.getDistance().getInMeters();
            any += m;
            if (pkg != null && pkg.equals(d.getMetadata().getDataOrigin().getPackageName())) same += m;
        }
        return same > 0 ? same : any;
    }

    private static <T extends Record> List<T> read(HealthConnectManager hc, Class<T> type, Instant from, Instant to) throws Exception {
        CountDownLatch done = new CountDownLatch(1);
        AtomicReference<List<T>> out = new AtomicReference<>(new ArrayList<>());
        AtomicReference<Exception> err = new AtomicReference<>();
        ReadRecordsRequestUsingFilters<T> req = new ReadRecordsRequestUsingFilters.Builder<>(type)
                .setTimeRangeFilter(new TimeInstantRangeFilter.Builder().setStartTime(from).setEndTime(to).build())
                .setPageSize(1000)
                .build();
        hc.readRecords(req, Runnable::run, new OutcomeReceiver<ReadRecordsResponse<T>, HealthConnectException>() {
            @Override public void onResult(ReadRecordsResponse<T> r) { out.set(r.getRecords()); done.countDown(); }
            @Override public void onError(HealthConnectException e) { err.set(e); done.countDown(); }
        });
        if (!done.await(15, TimeUnit.SECONDS)) throw new Exception("timeout");
        if (err.get() != null) throw err.get();
        return out.get();
    }

    private HealthRun() {}
}
