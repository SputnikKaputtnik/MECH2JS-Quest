package quest.mech2;

import android.content.Context;
import android.util.Log;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.json.*;

/** Android asset/profile adapter; the HTTP implementation also runs in JVM tests. */
public final class AndroidContent {
    private static LocalGameServer instance;
    public static synchronized void start(Context context) throws IOException {
        if (instance != null) return;
        File data = new File(context.getFilesDir(), "game-data");
        Set<String> files = new TreeSet<>();
        File manifest = new File(data, "manifest.json");
        if (manifest.isFile()) {
            try (InputStream in = new FileInputStream(manifest)) {
                JSONArray entries = new JSONObject(new String(LocalGameServer.readAll(in), StandardCharsets.UTF_8)).getJSONArray("files");
                for (int i = 0; i < entries.length(); i++) {
                    JSONObject entry = entries.getJSONObject(i);
                    String name = entry.getString("name");
                    File file = new File(data, name);
                    if (!file.isFile() || file.length() != entry.getLong("size")) throw new IOException("Incomplete data: " + name);
                    files.add(name);
                }
            } catch (JSONException e) { throw new IOException("Invalid game manifest", e); }
        }
        instance = new LocalGameServer(data, files, path -> context.getAssets().open(path));
        Log.i("MECH2Quest", "Own runtime content ready; " + files.size() + " game files");
    }
}
