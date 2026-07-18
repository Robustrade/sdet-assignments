package com.wallet.models;

public class TransferRequest {
    private String source_wallet_id;
    private String destination_wallet_id;
    private double amount;
    private String currency;
    private String reference;

    // Constructor
    public TransferRequest(String source_wallet_id, String destination_wallet_id, double amount, String currency, String reference) {
        this.source_wallet_id = source_wallet_id;
        this.destination_wallet_id = destination_wallet_id;
        this.amount = amount;
        this.currency = currency;
        this.reference = reference;
    }

    // Getters and Setters
    public String getSource_wallet_id() { return source_wallet_id; }
    public void setSource_wallet_id(String source_wallet_id) { this.source_wallet_id = source_wallet_id; }

    public String getDestination_wallet_id() { return destination_wallet_id; }
    public void setDestination_wallet_id(String destination_wallet_id) { this.destination_wallet_id = destination_wallet_id; }

    public double getAmount() { return amount; }
    public void setAmount(double amount) { this.amount = amount; }

    public String getCurrency() { return currency; }
    public void setCurrency(String currency) { this.currency = currency; }

    public String getReference() { return reference; }
    public void setReference(String reference) { this.reference = reference; }
}