package quest.mech2;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.util.Log;

/** Initializes local content before the embedded engine's application starts. */
public final class RuntimeProvider extends ContentProvider {
    @Override public boolean onCreate() {
        Context context = getContext();
        context.getSharedPreferences(context.getPackageName() + "_preferences", 0).edit()
            .putString("settings_homepage", LocalGameServer.ORIGIN + "/?native=1")
            .putBoolean("settings_telemetry", false)
            .putBoolean("settings_crash", false)
            .putBoolean("settings_key_telemetry_status_update_sent", true)
            .putBoolean("settings_remote_debugging", true)
            .putBoolean("settings_key_whats_new_displayed", true)
            .apply();
        try { AndroidContent.start(context); }
        catch (Exception error) { Log.e("MECH2Quest", "Local content unavailable", error); }
        return true;
    }
    @Override public Cursor query(Uri uri, String[] columns, String selection, String[] args, String sort) { return null; }
    @Override public String getType(Uri uri) { return null; }
    @Override public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException(); }
    @Override public int delete(Uri uri, String selection, String[] args) { throw new UnsupportedOperationException(); }
    @Override public int update(Uri uri, ContentValues values, String selection, String[] args) { throw new UnsupportedOperationException(); }
}
