package tw.wade.schedule;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.webkit.WebViewAssetLoader;

import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

public class MainActivity extends Activity {
    static final String EXTRA_QUICK_ADD = "quickAdd";
    static final String EXTRA_VIEW = "view";
    private static final int REQ_FILE = 1;
    private static final int REQ_EXPORT = 2;
    private static final int REQ_HEALTH = 3;
    private static final int REQ_BACKUP = 4;
    private static final String START_URL = "https://appassets.androidplatform.net/assets/www/index.html";

    private WebView web;
    private ValueCallback<Uri[]> fileCallback;
    private String pendingExport;
    private boolean pageReady;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return loader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                if ("appassets.androidplatform.net".equals(u.getHost())) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) { }
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                pageReady = true;
                handleView(getIntent()); handleQuickAdd(getIntent());
                runAutoCheck();
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent i = new Intent(Intent.ACTION_GET_CONTENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("*/*");
                try {
                    startActivityForResult(Intent.createChooser(i, "選擇備份檔"), REQ_FILE);
                } catch (Exception e) {
                    fileCallback = null;
                    return false;
                }
                return true;
            }
        });

        web.addJavascriptInterface(new Bridge(), "Android");
        setContentView(web);
        web.loadUrl(START_URL);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (pageReady) { handleView(intent); handleQuickAdd(intent); }
    }

    @Override
    protected void onPause() {
        super.onPause();
        String json = Store.load(this);
        if (json != null) Backup.onSaved(this, json, true);   // leaving the app: push the latest copy to the cloud file
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (pageReady) runAutoCheck();
    }

    private void runAutoCheck() {
        new Thread(() -> {
            AutoCheck.run(this);
            runOnUiThread(() -> { notifyPage(null); ScheduleWidget.refreshAll(this); });
        }).start();
    }

    private void notifyPage(String message) {
        String arg = message == null ? "null" : org.json.JSONObject.quote(message);
        web.evaluateJavascript("window.onAutoChecked && window.onAutoChecked(" + arg + ")", null);
    }

    private void handleQuickAdd(Intent intent) {
        if (intent != null && intent.getBooleanExtra(EXTRA_QUICK_ADD, false)) {
            intent.removeExtra(EXTRA_QUICK_ADD);
            web.evaluateJavascript("window.openQuickAdd && window.openQuickAdd()", null);
        }
    }

    /** Opens a tab when launched from a widget: "cal" (calendar) or "report". */
    private void handleView(Intent intent) {
        String v = intent == null ? null : intent.getStringExtra(EXTRA_VIEW);
        if (v == null) return;
        intent.removeExtra(EXTRA_VIEW);
        web.evaluateJavascript("window.goView && window.goView(" + org.json.JSONObject.quote(v) + ")", null);
    }

    /** Back closes the open form / goes back to the calendar first; only leaves the app at the very end. */
    @Override
    public void onBackPressed() {
        if (!pageReady) { moveTaskToBack(true); return; }
        web.evaluateJavascript("window.handleBack ? window.handleBack() : false", value -> {
            if (!"true".equals(value)) moveTaskToBack(true);
        });
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode != REQ_HEALTH) return;
        boolean ok = HealthRun.granted(this);
        notifyPage(ok ? "已連結 Health Connect，跑步會自動打勾。" : "沒有拿到 Health Connect 權限。可以到 Health Connect →「App 權限」→ 日程表，把運動和距離打開。");
        if (ok) runAutoCheck();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_FILE) {
            if (fileCallback != null) {
                fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
                fileCallback = null;
            }
        } else if (requestCode == REQ_BACKUP) {
            if (resultCode == RESULT_OK && data != null && data.getData() != null) {
                Uri u = data.getData();
                try {
                    getContentResolver().takePersistableUriPermission(u, Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                } catch (Exception ignored) { /* some providers only allow access while the app runs; we still try */ }
                Backup.setTarget(this, u, u.getLastPathSegment());
                String json = Store.load(this);
                if (json != null) Backup.onSaved(this, json, true);
                notifyPage("已設定自動備份位置，之後會自動更新這個檔案。");
            }
        } else if (requestCode == REQ_EXPORT && resultCode == RESULT_OK && data != null && pendingExport != null) {
            try (OutputStream out = getContentResolver().openOutputStream(data.getData())) {
                out.write(pendingExport.getBytes(StandardCharsets.UTF_8));
                Toast.makeText(this, "已匯出備份", Toast.LENGTH_SHORT).show();
            } catch (Exception e) {
                Toast.makeText(this, "匯出失敗", Toast.LENGTH_SHORT).show();
            }
            pendingExport = null;
        }
    }

    private static String today() {
        return new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
    }

    /** Called from the page's JavaScript as window.Android.* */
    private class Bridge {
        @JavascriptInterface
        public void save(String json) {
            Store.save(MainActivity.this, json);
            Backup.onSaved(MainActivity.this, json, false);
            ScheduleWidget.refreshAll(MainActivity.this);
            ReportWidget.refreshAll(MainActivity.this);
        }

        @JavascriptInterface
        public String load() {
            return Store.load(MainActivity.this);
        }

        @JavascriptInterface
        public void openApp(final String pkg, final String webUrl) {
            runOnUiThread(() -> {
                Intent i = getPackageManager().getLaunchIntentForPackage(pkg);
                if (i == null) i = new Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=" + pkg));
                try {
                    startActivity(i);
                } catch (Exception e) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(webUrl))); } catch (Exception ignored) { }
                }
            });
        }

        @JavascriptInterface
        public String autoStatus() {
            return "{\"usage\":" + AutoCheck.usageGranted(MainActivity.this)
                    + ",\"health\":" + HealthRun.granted(MainActivity.this)
                    + ",\"healthAvail\":" + HealthRun.available(MainActivity.this)
                    + "}";
        }

        /** Asks for permission to read runs (exercise + distance) from Health Connect. */
        @JavascriptInterface
        public void healthConnect() {
            runOnUiThread(() -> {
                if (!HealthRun.available(MainActivity.this)) { notifyPage("這支手機沒有內建 Health Connect（需要 Android 14 以上）。"); return; }
                requestPermissions(HealthRun.PERMS, REQ_HEALTH);
            });
        }

        @JavascriptInterface
        public void openUsageSettings() {
            runOnUiThread(() -> {
                try { startActivity(new Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS)); } catch (Exception ignored) { }
            });
        }

        @JavascriptInterface
        public void setReminder(String time) {
            DailyReminder.schedule(MainActivity.this, time);
        }

        @JavascriptInterface
        public void askNotificationPermission() {
            runOnUiThread(() -> {
                if (android.os.Build.VERSION.SDK_INT >= 33)
                    requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, 5);
                else Toast.makeText(MainActivity.this, "通知已經可以用了", Toast.LENGTH_SHORT).show();
            });
        }

        /** The page tells the report widget about today's report (title + date). */
        @JavascriptInterface
        public void setReport(String date, String title) {
            ReportWidget.remember(MainActivity.this, date, title);
            ReportWidget.refreshAll(MainActivity.this);
        }

        // ---------- backup ----------
        @JavascriptInterface
        public void backupPick() {
            runOnUiThread(() -> {
                Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("application/json");
                i.putExtra(Intent.EXTRA_TITLE, "日程表自動備份.json");
                try { startActivityForResult(i, REQ_BACKUP); } catch (Exception e) { notifyPage("打不開選擇位置的畫面。"); }
            });
        }

        @JavascriptInterface
        public String backupStatus() { return Backup.status(MainActivity.this); }

        @JavascriptInterface
        public void backupNow() {
            String json = Store.load(MainActivity.this);
            if (json != null) Backup.onSaved(MainActivity.this, json, true);
        }

        @JavascriptInterface
        public void backupOff() { Backup.clearTarget(MainActivity.this); }

        @JavascriptInterface
        public String backupLoad(String day) { return Backup.load(MainActivity.this, day); }

        // ---------- updates ----------
        @JavascriptInterface
        public int appVersion() {
            try { return (int) getPackageManager().getPackageInfo(getPackageName(), 0).getLongVersionCode(); } catch (Exception e) { return 0; }
        }

        @JavascriptInterface
        public void openUrl(final String url) {
            runOnUiThread(() -> { try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); } catch (Exception ignored) { } });
        }

        @JavascriptInterface
        public void checkNow() {
            runOnUiThread(MainActivity.this::runAutoCheck);
        }

        @JavascriptInterface
        public void exportData(final String json) {
            pendingExport = json;
            runOnUiThread(() -> {
                Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("application/json");
                i.putExtra(Intent.EXTRA_TITLE, "日程備份-" + today() + ".json");
                try { startActivityForResult(i, REQ_EXPORT); } catch (Exception ignored) { }
            });
        }
    }
}
