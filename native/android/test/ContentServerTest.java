package quest.mech2;

import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;

/** Real socket tests: same server implementation as Android, no game assets. */
public final class ContentServerTest {
    static String request(String method, String path, String headers) throws Exception {
        try (Socket socket = new Socket("127.0.0.1", LocalGameServer.PORT)) {
            socket.setSoTimeout(3000);
            socket.getOutputStream().write((method + " " + path + " HTTP/1.1\r\n" + headers + "\r\n").getBytes(StandardCharsets.US_ASCII));
            return new String(LocalGameServer.readAll(socket.getInputStream()), StandardCharsets.US_ASCII);
        }
    }
    static void check(boolean value, String name) { if (!value) throw new AssertionError(name); }
    public static void main(String[] args) throws Exception {
        Path data = Paths.get(args[0]);
        Files.createDirectories(data.resolve("GIDDI"));
        Files.write(data.resolve("MW2.PRJ"), "0123456789".getBytes(StandardCharsets.US_ASCII));
        Files.write(data.resolve("GIDDI/KEYBOARD.DLL"), new byte[]{1});
        Files.write(data.resolve("UNLISTED.TXT"), new byte[]{2});
        Set<String> files = new TreeSet<>(Arrays.asList("MW2.PRJ", "GIDDI/KEYBOARD.DLL"));
        String host = "Host: 127.0.0.1:" + LocalGameServer.PORT + "\r\n";
        try (LocalGameServer server = new LocalGameServer(data.toFile(), files, name -> {
            if (name.equals("mech2/index.html")) return new ByteArrayInputStream("<html>test</html>".getBytes(StandardCharsets.US_ASCII));
            throw new IOException("Missing Android asset");
        })) {
            check(request("GET", "/?native=1", host).endsWith("<html>test</html>"), "app entry");
            check(request("GET", "/mw2/__list/", host).endsWith("[\"MW2.PRJ\"]"), "root list");
            check(request("GET", "/mw2/__list/giddi", host).endsWith("[\"GIDDI/KEYBOARD.DLL\"]"), "nested list");
            check(request("GET", "/mw2/mw2.prj", host).endsWith("0123456789"), "case insensitive content");
            String partial = request("GET", "/mw2/MW2.PRJ", host + "Range: bytes=2-5\r\n");
            check(partial.startsWith("HTTP/1.1 206") && partial.contains("Content-Range: bytes 2-5/10") && partial.endsWith("2345"), "exact range");
            check(request("GET", "/mw2/MW2.PRJ", host + "Range: bytes=7-\r\n").endsWith("789"), "open range");
            check(request("GET", "/mw2/MW2.PRJ", host + "Range: bytes=7-100\r\n").endsWith("789"), "clamped range");
            String head = request("HEAD", "/mw2/MW2.PRJ", host);
            check(head.contains("Content-Length: 10") && head.endsWith("\r\n\r\n"), "head has no body");
            for (String range : Arrays.asList("bytes=10-", "bytes=6-2", "bytes=999999999999999999999999-", "bytes=0-1,3-4"))
                check(request("GET", "/mw2/MW2.PRJ", host + "Range: " + range + "\r\n").startsWith("HTTP/1.1 416"), "reject invalid range");
            for (String target : Arrays.asList("/mw2/UNLISTED.TXT", "/missing.js"))
                check(request("GET", target, host).startsWith("HTTP/1.1 404"), "unknown file");
            for (String target : Arrays.asList("/%2e%2e/secret", "/mw2/%5csecret", "/%00", "/%broken"))
                check(request("GET", target, host).startsWith("HTTP/1.1 400"), "reject malformed path");
            check(request("GET", "/", "Host: foreign.example\r\n").startsWith("HTTP/1.1 403"), "host restriction");
            check(request("GET", "/", host + "Sec-Fetch-Site: cross-site\r\n").startsWith("HTTP/1.1 403"), "cross site restriction");
            check(request("POST", "/", host).startsWith("HTTP/1.1 403"), "read only");
        }
        System.out.println("ContentServerTest: 21 HTTP cases passed");
    }
}
