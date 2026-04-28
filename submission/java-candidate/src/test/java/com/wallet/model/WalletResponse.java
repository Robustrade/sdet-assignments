package com.wallet.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.math.BigDecimal;
import java.time.Instant;

/** Mirrors the GET /wallets/{id} response payload. */
@JsonIgnoreProperties(ignoreUnknown = true)
public class WalletResponse {

    @JsonProperty("id")        private String id;
    @JsonProperty("ownerName") private String ownerName;
    @JsonProperty("balance")   private BigDecimal balance;
    @JsonProperty("currency")  private String currency;
    @JsonProperty("updatedAt") private Instant updatedAt;

    public WalletResponse() {}

    public String getId()                  { return id; }
    public void setId(String v)            { this.id = v; }
    public String getOwnerName()           { return ownerName; }
    public void setOwnerName(String v)     { this.ownerName = v; }
    public BigDecimal getBalance()         { return balance; }
    public void setBalance(BigDecimal v)   { this.balance = v; }
    public String getCurrency()            { return currency; }
    public void setCurrency(String v)      { this.currency = v; }
    public Instant getUpdatedAt()          { return updatedAt; }
    public void setUpdatedAt(Instant v)    { this.updatedAt = v; }
}
