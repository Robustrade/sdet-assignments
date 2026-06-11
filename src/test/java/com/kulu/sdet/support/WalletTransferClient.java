package com.kulu.sdet.support;

import com.kulu.sdet.model.TransferRequest;
import com.kulu.sdet.model.TransferResponse;
import com.kulu.sdet.model.WalletResponse;
import io.restassured.response.Response;

import java.math.BigDecimal;

public class WalletTransferClient {

    private final ApiClient api;


    public WalletTransferClient() {
        this.api = new ApiClient();
    }


    public WalletTransferClient(String baseUrl) {
        this.api = new ApiClient(baseUrl);
    }


    public TransferResponse createTransfer(TransferRequest request) {
        Response raw = (request.getIdempotencyKey() != null) ? api.transfer(request.toMap(), request.getIdempotencyKey()).extract().response() : api.transfer(request.toMap()).extract().response();

        return toTransferResponse(raw);
    }


    public TransferResponse getTransfer(String transactionId) {
        Response raw = api.given().get(TestConfig.WALLET_BASE_PATH + "/transfer/{id}", transactionId).then().extract().response();

        return toTransferResponse(raw);
    }


    public WalletResponse getWallet(String walletId) {
        Response raw = api.getWallet(walletId).extract().response();
        return toWalletResponse(raw);
    }


    private TransferResponse toTransferResponse(Response raw) {
        TransferResponse.Builder builder = new TransferResponse.Builder().statusCode(raw.statusCode());

        if (raw.statusCode() >= 200 && raw.statusCode() < 300) {
            builder.transactionId(raw.jsonPath().getString("transactionId")).status(raw.jsonPath().getString("status")).fromWalletId(raw.jsonPath().getString("fromWalletId")).toWalletId(raw.jsonPath().getString("toWalletId")).currency(raw.jsonPath().getString("currency"));

            String amountStr = raw.jsonPath().getString("amount");
            if (amountStr != null) {
                builder.amount(new BigDecimal(amountStr));
            }
        } else {
            builder.errorMessage(raw.jsonPath().getString("error"));
        }

        return builder.build();
    }

    private WalletResponse toWalletResponse(Response raw) {
        WalletResponse.Builder builder = new WalletResponse.Builder().statusCode(raw.statusCode());

        if (raw.statusCode() >= 200 && raw.statusCode() < 300) {
            builder.id(raw.jsonPath().getString("id")).ownerId(raw.jsonPath().getString("ownerId")).currency(raw.jsonPath().getString("currency"));

            String balanceStr = raw.jsonPath().getString("balance");
            if (balanceStr != null) {
                builder.balance(new BigDecimal(balanceStr));
            }
        } else {
            builder.errorMessage(raw.jsonPath().getString("error"));
        }

        return builder.build();
    }
}
