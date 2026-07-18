package com.wallet.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.math.BigDecimal;
import java.time.OffsetDateTime;

@JsonIgnoreProperties(ignoreUnknown = true)
public class TransferResponse {

    @JsonProperty("transfer_id")
    private String transferId;

    @JsonProperty("status")
    private String status;

    @JsonProperty("source_wallet_id")
    private String sourceWalletId;

    @JsonProperty("destination_wallet_id")
    private String destinationWalletId;

    @JsonProperty("amount")
    private BigDecimal amount;

    @JsonProperty("currency")
    private String currency;

    @JsonProperty("reference")
    private String reference;

    @JsonProperty("idempotency_key")
    private String idempotencyKey;

    @JsonProperty("created_at")
    private String createdAt;

    @JsonProperty("message")
    private String message;

    @JsonProperty("error_code")
    private String errorCode;

    @JsonProperty("errors")
    private java.util.List<FieldError> errors;

    public String getTransferId() { return transferId; }
    public String getStatus() { return status; }
    public String getSourceWalletId() { return sourceWalletId; }
    public String getDestinationWalletId() { return destinationWalletId; }
    public BigDecimal getAmount() { return amount; }
    public String getCurrency() { return currency; }
    public String getReference() { return reference; }
    public String getIdempotencyKey() { return idempotencyKey; }
    public String getCreatedAt() { return createdAt; }
    public String getMessage() { return message; }
    public String getErrorCode() { return errorCode; }
    public java.util.List<FieldError> getErrors() { return errors; }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class FieldError {
        @JsonProperty("field")
        private String field;

        @JsonProperty("message")
        private String message;

        public String getField() { return field; }
        public String getMessage() { return message; }
    }
}