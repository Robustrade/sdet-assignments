package com.robustrade.wallet.http;

import com.robustrade.wallet.dto.ErrorResponseDto;
import com.robustrade.wallet.service.ReadService;
import com.robustrade.wallet.service.ServiceResult;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;

import java.io.IOException;

public class WalletHandler implements HttpHandler {

    private static final String BASE_PATH = "/wallets";

    private final ReadService readService;

    public WalletHandler(ReadService readService) {
        this.readService = readService;
    }

    @Override
    public void handle(HttpExchange exchange) throws IOException {
        String path = exchange.getRequestURI().getPath();
        String method = exchange.getRequestMethod();

        try {
            if ("GET".equalsIgnoreCase(method) && path.startsWith(BASE_PATH + "/")) {
                String walletId = path.substring((BASE_PATH + "/").length());
                ServiceResult result = readService.getWallet(walletId);
                JsonHttp.writeJson(exchange, result.statusCode, result.body);
                return;
            }
            JsonHttp.writeJson(exchange, 405, new ErrorResponseDto("METHOD_NOT_ALLOWED", method + " " + path + " is not supported"));
        } catch (Exception e) {
            JsonHttp.writeJson(exchange, 500, new ErrorResponseDto("INTERNAL_ERROR", e.getMessage()));
        }
    }
}
