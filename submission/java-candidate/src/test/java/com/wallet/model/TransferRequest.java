package com.wallet.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.math.BigDecimal;

/** Request body for POST /transfers — field names match the API spec exactly. */
@JsonIgnoreProperties(ignoreUnknown = true)  // ignore any extra fields the service might add later
public class TransferRequest {

    // snake_case to match what the API actually expects
    @JsonProperty("source_wallet_id")      private String sourceWalletId;
    @JsonProperty("destination_wallet_id") private String destinationWalletId;
    @JsonProperty("amount")                private BigDecimal amount;
    @JsonProperty("currency")              private String currency;
    @JsonProperty("reference")             private String reference;

    public TransferRequest() {}

    public String getSourceWalletId()              { return sourceWalletId; }
    public void setSourceWalletId(String v)        { this.sourceWalletId = v; }
    public String getDestinationWalletId()         { return destinationWalletId; }
    public void setDestinationWalletId(String v)   { this.destinationWalletId = v; }
    public BigDecimal getAmount()                  { return amount; }
    public void setAmount(BigDecimal v)            { this.amount = v; }
    public String getCurrency()                    { return currency; }
    public void setCurrency(String v)              { this.currency = v; }
    public String getReference()                   { return reference; }
    public void setReference(String v)             { this.reference = v; }
}
