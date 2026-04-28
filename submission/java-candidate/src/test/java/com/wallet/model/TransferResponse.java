package com.wallet.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.math.BigDecimal;
import java.time.Instant;

/** What the service sends back after a POST /transfers or GET /transfers/{id}. */
@JsonIgnoreProperties(ignoreUnknown = true)  // safe in case the service adds new fields down the road
public class TransferResponse {

    @JsonProperty("transferId")            private String transferId;
    @JsonProperty("sourceWalletId")        private String sourceWalletId;
    @JsonProperty("destinationWalletId")   private String destinationWalletId;
    @JsonProperty("amount")               private BigDecimal amount;
    @JsonProperty("currency")             private String currency;
    @JsonProperty("reference")            private String reference;
    @JsonProperty("status")               private String status;         // COMPLETED, REJECTED, etc.
    @JsonProperty("failureReason")        private String failureReason;  // only set when status != COMPLETED
    @JsonProperty("createdAt")            private Instant createdAt;

    public TransferResponse() {}

    public String getTransferId()                  { return transferId; }
    public void setTransferId(String v)            { this.transferId = v; }
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
    public String getStatus()                      { return status; }
    public void setStatus(String v)                { this.status = v; }
    public String getFailureReason()               { return failureReason; }
    public void setFailureReason(String v)         { this.failureReason = v; }
    public Instant getCreatedAt()                  { return createdAt; }
    public void setCreatedAt(Instant v)            { this.createdAt = v; }
}
