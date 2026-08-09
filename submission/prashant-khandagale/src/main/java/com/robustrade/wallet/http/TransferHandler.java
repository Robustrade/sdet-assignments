package com.robustrade.wallet.http;

import com.robustrade.wallet.dto.ErrorResponseDto;
import com.robustrade.wallet.dto.TransferRequestDto;
import com.robustrade.wallet.service.ReadService;
import com.robustrade.wallet.service.ServiceResult;
import com.robustrade.wallet.service.TransferService;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;

import java.io.IOException;

public class TransferHandler implements HttpHandler {

    private static final String BASE_PATH = "/transfers";

    private final TransferService transferService;
    private final ReadService readService;

    public TransferHandler(TransferService transferService, ReadService readService) {
        this.transferService = transferService;
        this.readService = readService;
    }

    @Override
    public void handle(HttpExchange exchange) throws IOException {
        String path = exchange.getRequestURI().getPath();
        String method = exchange.getRequestMethod();

        try {
            if ("POST".equalsIgnoreCase(method) && path.equals(BASE_PATH)) {
                handleCreate(exchange);
                return;
            }
            if ("GET".equalsIgnoreCase(method) && path.startsWith(BASE_PATH + "/")) {
                String transferId = path.substring((BASE_PATH + "/").length());
                ServiceResult result = readService.getTransfer(transferId);
                JsonHttp.writeJson(exchange, result.statusCode, result.body);
                return;
            }
            JsonHttp.writeJson(exchange, 405, new ErrorResponseDto("METHOD_NOT_ALLOWED", method + " " + path + " is not supported"));
        } catch (Exception e) {
            JsonHttp.writeJson(exchange, 500, new ErrorResponseDto("INTERNAL_ERROR", e.getMessage()));
        }
    }

    private void handleCreate(HttpExchange exchange) throws IOException {
        String body = JsonHttp.readBody(exchange);
        TransferRequestDto request;
        try {
            request = JsonHttp.MAPPER.readValue(body, TransferRequestDto.class);
        } catch (Exception e) {
            JsonHttp.writeJson(exchange, 400, new ErrorResponseDto("MALFORMED_REQUEST", "Request body is not valid JSON"));
            return;
        }
        if (request == null) {
            JsonHttp.writeJson(exchange, 400, new ErrorResponseDto("MALFORMED_REQUEST", "Request body must be a JSON object"));
            return;
        }
        String idempotencyKey = exchange.getRequestHeaders().getFirst("Idempotency-Key");
        ServiceResult result = transferService.createTransfer(request, idempotencyKey);
        JsonHttp.writeJson(exchange, result.statusCode, result.body);
    }
}
