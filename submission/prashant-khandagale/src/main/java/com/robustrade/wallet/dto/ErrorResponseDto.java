package com.robustrade.wallet.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

public class ErrorResponseDto {

    @JsonProperty("error")
    public String error;

    @JsonProperty("message")
    public String message;

    public ErrorResponseDto() {
    }

    public ErrorResponseDto(String error, String message) {
        this.error = error;
        this.message = message;
    }
}
