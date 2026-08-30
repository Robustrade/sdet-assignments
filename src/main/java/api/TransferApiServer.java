package api;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import service.TransferService;

import java.io.IOException;
import java.math.BigDecimal;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;

public class TransferApiServer {

    private HttpServer server;

    public void start() throws IOException {

        server = HttpServer.create(new InetSocketAddress(8080), 0);

        server.createContext("/transfers", this::handleTransfer);

        server.start();

        System.out.println("Transfer API started on port 8080");
    }

    public void stop() {

        if (server != null) {
            server.stop(0);
            System.out.println("Transfer API stopped");
        }
    }

    private void handleTransfer(HttpExchange exchange) throws IOException {

        if (!"POST".equalsIgnoreCase(exchange.getRequestMethod())) {

            sendResponse(
                    exchange,
                    405,
                    "{\"error\":\"Method not allowed\"}"
            );

            return;
        }
        String contentType = exchange.getRequestHeaders()
                .getFirst("Content-Type");

        if (contentType == null
                || !contentType.toLowerCase().startsWith("application/json")) {

            sendResponse(
                    exchange,
                    400,
                    "{\"error\":\"Content-Type must be application/json\"}"
            );
            return;
        }

        try {

            String idempotencyKey =
                    exchange.getRequestHeaders().getFirst("Idempotency-Key");

            String body =
                    new String(
                            exchange.getRequestBody().readAllBytes(),
                            StandardCharsets.UTF_8
                    );

            long sourceWalletId =
                    extractLong(body, "source_wallet_id");

            long destinationWalletId =
                    extractLong(body, "destination_wallet_id");

            BigDecimal amount =
                    extractDecimal(body, "amount");

            TransferService.transfer(
                    sourceWalletId,
                    destinationWalletId,
                    amount,
                    idempotencyKey
            );

            sendResponse(
                    exchange,
                    200,
                    "{\"status\":\"completed\"}"
            );

        } catch (Exception e) {

            sendResponse(
                    exchange,
                    400,
                    "{\"error\":\"" + escapeJson(e.getMessage()) + "\"}"
            );
        }
    }

    private long extractLong(String json, String field) {

        String value = extractValue(json, field);

        return Long.parseLong(value);
    }

    private BigDecimal extractDecimal(String json, String field) {

        String value = extractValue(json, field);

        return new BigDecimal(value);
    }
    
    private String extractValue(String json, String field) {

        if (json == null || json.isBlank()) {
            throw new IllegalArgumentException("Request body must not be empty");
        }

        // Basic JSON structure validation
        String trimmedJson = json.trim();

        if (!trimmedJson.startsWith("{") || !trimmedJson.endsWith("}")) {
            throw new IllegalArgumentException("Malformed JSON request");
        }

        String search = "\"" + field + "\"";

        int fieldPosition = trimmedJson.indexOf(search);

        if (fieldPosition == -1) {
            throw new IllegalArgumentException(
                    "Missing required field: " + field);
        }

        int colonPosition = trimmedJson.indexOf(":", fieldPosition);

        if (colonPosition == -1) {
            throw new IllegalArgumentException(
                    "Invalid JSON field: " + field);
        }

        int start = colonPosition + 1;

        while (start < trimmedJson.length()
                && Character.isWhitespace(trimmedJson.charAt(start))) {
            start++;
        }

        int end = start;

        while (end < trimmedJson.length()
                && trimmedJson.charAt(end) != ','
                && trimmedJson.charAt(end) != '}') {
            end++;
        }

        if (start == end) {
            throw new IllegalArgumentException(
                    "Missing value for field: " + field);
        }

        return trimmedJson
                .substring(start, end)
                .trim()
                .replace("\"", "");
    }


    private void sendResponse(
            HttpExchange exchange,
            int statusCode,
            String response)
            throws IOException {

        byte[] responseBytes =
                response.getBytes(StandardCharsets.UTF_8);

        exchange.getResponseHeaders()
                .set("Content-Type", "application/json");

        exchange.sendResponseHeaders(
                statusCode,
                responseBytes.length
        );

        exchange.getResponseBody()
                .write(responseBytes);

        exchange.close();
    }

    private String escapeJson(String value) {

        if (value == null) {
            return "";
        }

        return value.replace("\\", "\\\\")
                .replace("\"", "\\\"");
    }

    public static void main(String[] args) throws Exception {

        TransferApiServer apiServer =
                new TransferApiServer();

        apiServer.start();

        System.out.println(
                "Press Ctrl+C to stop the API."
        );
    }
}