package quest.mech2;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.widget.TextView;

/** Own launcher; the XR engine lives in this APK/process, never in Quest Browser. */
public final class BootstrapActivity extends Activity {
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        try {
            AndroidContent.start(getApplicationContext());
            Intent game = new Intent(Intent.ACTION_VIEW, Uri.parse(LocalGameServer.ORIGIN + "/?native=1"));
            game.setClassName(getPackageName(), "com.igalia.wolvic.VRBrowserActivity");
            // Wolvic's kiosk/launch_immersive intents create private sessions.
            // Use a normal, persistent profile for pilot saves and VR settings.
            game.putExtra("hide_whats_new", true);
            game.putExtra("hide_webxr_interstitial", true);
            startActivity(game);
            finish();
        } catch (Exception error) {
            TextView message = new TextView(this);
            message.setText("MECH2 Quest konnte nicht starten.\n" + error.getMessage());
            message.setTextSize(22);
            message.setPadding(32, 32, 32, 32);
            setContentView(message);
        }
    }
}
