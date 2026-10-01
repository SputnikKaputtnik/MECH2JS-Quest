package quest.mech2;

import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;

/** Loopback-only read-only content host. No PC connection or network server required. */
public final class LocalGameServer implements Closeable {
    public static final int PORT = 19895;
    public static final String ORIGIN = "http://127.0.0.1:" + PORT;
    public interface Assets { InputStream open(String path) throws IOException; }
    private final Assets assets;
    private final File data;
    private final ServerSocket listener;
    private final ExecutorService workers = new ThreadPoolExecutor(2, 4, 30, TimeUnit.SECONDS,
        new ArrayBlockingQueue<Runnable>(64), new ThreadPoolExecutor.AbortPolicy());
    private final Set<String> files;

    public LocalGameServer(File data, Set<String> files, Assets assets) throws IOException {
        this.data = data.getCanonicalFile();
        this.files = new TreeSet<>(files);
        this.assets = assets;
        for (String name : files) {
            File file = new File(this.data, name).getCanonicalFile();
            if (!name.matches("[A-Z0-9_/-]+(?:\\.[A-Z0-9_]+)?") || name.startsWith("/")
                || !file.toPath().startsWith(this.data.toPath()) || !file.isFile())
                throw new IOException("Invalid data path: " + name);
        }
        listener = new ServerSocket();
        listener.setReuseAddress(true);
        listener.bind(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), PORT));
        Thread thread = new Thread(() -> {
            while (!listener.isClosed()) {
                try {
                    final Socket socket = listener.accept();
                    try { workers.execute(() -> serve(socket)); }
                    catch (RejectedExecutionException e) { socket.close(); }
                } catch (IOException e) { if (!listener.isClosed()) System.err.println("MECH2 content listener: " + e); }
            }
        }, "MECH2-local-content");
        thread.setDaemon(true);
        thread.start();
    }
    @Override public void close() throws IOException { listener.close(); workers.shutdownNow(); }
    static byte[] readAll(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buffer = new byte[32768];
        int count;
        while ((count = in.read(buffer)) != -1) out.write(buffer, 0, count);
        return out.toByteArray();
    }
    private void serve(Socket socket) {
        try (Socket s = socket) {
            s.setSoTimeout(10000);
            BufferedReader reader = new BufferedReader(new InputStreamReader(s.getInputStream(), StandardCharsets.US_ASCII));
            String request = reader.readLine();
            if (request == null || request.length() > 8192) return;
            String[] parts = request.split(" ");
            if (parts.length != 3) return;
            Map<String, String> headers = new HashMap<>();
            for (int n = 0; n < 64; n++) {
                String line = reader.readLine();
                if (line == null || line.isEmpty()) break;
                if (line.length() > 8192) return;
                int colon = line.indexOf(':');
                if (colon > 0) headers.put(line.substring(0, colon).toLowerCase(Locale.ROOT), line.substring(colon+1).trim());
            }
            OutputStream out = s.getOutputStream();
            boolean head = parts[0].equals("HEAD");
            if ((!head && !parts[0].equals("GET")) || !("127.0.0.1:" + PORT).equals(headers.get("host"))
                || "cross-site".equals(headers.get("sec-fetch-site"))) {
                bytes(out, 403, "text/plain", "Forbidden".getBytes(StandardCharsets.UTF_8), head); return;
            }
            String path;
            try { path = URLDecoder.decode(parts[1].split("\\?", 2)[0], "UTF-8"); }
            catch (IllegalArgumentException e) { bytes(out, 400, "text/plain", new byte[0], head); return; }
            if (!path.startsWith("/") || path.contains("..") || path.contains("\\") || path.indexOf(0) >= 0) {
                bytes(out, 400, "text/plain", new byte[0], head); return;
            }
            if (path.startsWith("/mw2/__list/")) {
                String dir = path.substring(12).toUpperCase(Locale.ROOT).replaceAll("/+$", "");
                String prefix = dir.isEmpty() ? "" : dir + "/";
                StringJoiner list = new StringJoiner(",", "[", "]");
                for (String name : files) if (name.startsWith(prefix) && !name.substring(prefix.length()).contains("/")) list.add("\"" + name + "\"");
                bytes(out, 200, "application/json", list.toString().getBytes(StandardCharsets.UTF_8), head); return;
            }
            if (path.startsWith("/mw2/")) {
                String name = path.substring(5).toUpperCase(Locale.ROOT);
                if (!files.contains(name)) { bytes(out, 404, "text/plain", new byte[0], head); return; }
                File file = new File(data, name);
                long start = 0, end = file.length()-1;
                boolean partial = headers.containsKey("range");
                if (partial) {
                    String range = headers.get("range");
                    if (!range.matches("bytes=[0-9]+-[0-9]*")) { bytes(out, 416, "text/plain", new byte[0], head); return; }
                    String[] limits = range.substring(6).split("-", -1);
                    try {
                        start = Long.parseLong(limits[0]);
                        if (!limits[1].isEmpty()) end = Math.min(end, Long.parseLong(limits[1]));
                    } catch (NumberFormatException e) { bytes(out, 416, "text/plain", new byte[0], head); return; }
                    if (start > end || start >= file.length()) { bytes(out, 416, "text/plain", new byte[0], head); return; }
                }
                long length = end-start+1;
                header(out, partial ? 206 : 200, "application/octet-stream", length,
                    partial ? "Content-Range: bytes " + start + "-" + end + "/" + file.length() + "\r\n" : "");
                if (!head) try (RandomAccessFile in = new RandomAccessFile(file, "r")) {
                    in.seek(start);
                    byte[] buffer = new byte[65536];
                    while (length > 0) { int n = in.read(buffer, 0, (int)Math.min(length, buffer.length)); if (n < 0) break; out.write(buffer, 0, n); length -= n; }
                }
                return;
            }
            if (path.equals("/native-info.json")) {
                bytes(out, 200, "application/json", ("{\"runtime\":\"embedded-chromium-openxr\",\"files\":" + files.size() + "}").getBytes(StandardCharsets.UTF_8), head); return;
            }
            if (path.equals("/")) path = "/index.html";
            InputStream asset;
            try { asset = assets.open("mech2" + path); }
            catch (IOException e) { bytes(out, 404, "text/plain", new byte[0], head); return; }
            try (InputStream in = asset) {
                String mime = path.endsWith(".js") ? "text/javascript" : path.endsWith(".css") ? "text/css" : path.endsWith(".html") ? "text/html" : path.endsWith(".json") ? "application/json" : path.endsWith(".wasm") ? "application/wasm" : "application/octet-stream";
                bytes(out, 200, mime, readAll(in), head);
            }
        } catch (Exception e) { System.err.println("MECH2 content request: " + e.getMessage()); }
    }
    private static void header(OutputStream out, int status, String mime, long length, String extra) throws IOException {
        String reason = status == 200 ? "OK" : status == 206 ? "Partial Content" : "Error";
        out.write(("HTTP/1.1 " + status + " " + reason + "\r\nContent-Type: " + mime + "\r\nContent-Length: " + length
            + "\r\nConnection: close\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nAccept-Ranges: bytes\r\n" + extra + "\r\n").getBytes(StandardCharsets.US_ASCII));
    }
    private static void bytes(OutputStream out, int status, String mime, byte[] body, boolean head) throws IOException {
        header(out, status, mime, body.length, "");
        if (!head) out.write(body);
    }
}
