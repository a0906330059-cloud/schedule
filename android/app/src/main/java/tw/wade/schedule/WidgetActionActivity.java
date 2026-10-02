package tw.wade.schedule;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;

/**
 * Invisible hop for widget taps. Tapping a row opens the app; tapping a row's
 * checkbox ticks it without opening anything. (One list can only have one
 * click template, so both go through here.)
 */
public class WidgetActionActivity extends Activity {
    static final String EXTRA_ACT = "act";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Intent in = getIntent();
        if ("toggle".equals(in.getStringExtra(EXTRA_ACT))) {
            ScheduleWidget.toggle(this, in.getStringExtra(ScheduleWidget.EXTRA_TYPE), in.getStringExtra(ScheduleWidget.EXTRA_ID));
            ScheduleWidget.refreshAll(this);
        } else {
            startActivity(new Intent(this, MainActivity.class)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    .putExtra(MainActivity.EXTRA_VIEW, "cal"));
        }
        finish();
    }
}
