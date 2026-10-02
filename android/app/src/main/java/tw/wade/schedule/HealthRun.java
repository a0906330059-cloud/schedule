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

    /** Kilometres run today, or -1 if unknown (no permission, too old Android, app in background…). */
    static double runKmToday(Context c) {
        if (!granted(c)) return -1;
        try {
            HealthConnectManager hc = c.getSystemService(HealthConnectManager.class);
            Calendar day = Calendar.getInstance();
            day.set(Calendar.HOUR_OF_DAY, 0); day.set(Calendar.MINUTE, 0); day.set(Calendar.SECOND, 0); day.set(Calendar.MILLISECOND, 0);
            Instant from = Instant.ofEpochMilli(day.getTimeInMillis()), to = Instant.now();

            List<ExerciseSessionRecord> runs = new ArrayList<>();
            for (ExerciseSessionRecord s : read(hc, ExerciseSessionRecord.class, from, to)) {
                int t = s.getExerciseType();
                if (t == ExerciseSessionType.EXERCISE_SESSION_TYPE_RUNNING || t == ExerciseSessionType.EXERCISE_SESSION_TYPE_RUNNING_TREADMILL) runs.add(s);
            }
            if (runs.isEmpty()) return 0;
            List<DistanceRecord> dist = read(hc, DistanceRecord.class, from, to);

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
