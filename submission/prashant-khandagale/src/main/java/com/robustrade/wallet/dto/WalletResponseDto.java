package com.robustrade.wallet.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.math.BigDecimal;

public class WalletResponseDto {

    @JsonProperty("wallet_id")
    public String walletId;

    @JsonProperty("currency")
    public String currency;

    @JsonProperty("balance")
    public BigDecimal balance;

    public WalletResponseDto() {
    }

    public WalletResponseDto(String walletId, String currency, BigDecimal balance) {
        this.walletId = walletId;
        this.currency = currency;
        this.balance = balance;
    }
}
