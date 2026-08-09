//package com.kulu.models;
//
//public class TransferRequest {
//    private String sourceWalletId;
//    private String destinationWalletId;
//    private double amount;
//    private String currency;
//    private String reference;
//
//    private TransferRequest(Builder builder) {
//        this.sourceWalletId = builder.sourceWalletId;
//        this.destinationWalletId = builder.destinationWalletId;
//        this.amount = builder.amount;
//        this.currency = builder.currency;
//        this.reference = builder.reference;
//    }
//
//    public String getSourceWalletId() { return sourceWalletId; }
//    public String getDestinationWalletId() { return destinationWalletId; }
//    public double getAmount() { return amount; }
//    public String getCurrency() { return currency; }
//    public String getReference() { return reference; }
//
//    public static class Builder {
//        private String sourceWalletId;
//        private String destinationWalletId;
//        private double amount;
//        private String currency = "AED"; // Default based on requirements
//        private String reference = "test_invoice_001";
//
//        public static Builder aTransfer() { return new Builder(); }
//
//        public Builder withSource(String source) { this.sourceWalletId = source; return this; }
//        public Builder withDestination(String dest) { this.destinationWalletId = dest; return this; }
//        public Builder withAmount(double amount) { this.amount = amount; return this; }
//        public Builder withCurrency(String currency) { this.currency = currency; return this; }
//        public Builder withReference(String reference) { this.reference = reference; return this; }
//
//        public TransferRequest build() { return new TransferRequest(this); }
//    }
//}
package com.kulu.models;

public class TransferRequest {
    private final String sourceWalletId;
    private final String destinationWalletId;
    private final double amount;
    private final String currency;

    private TransferRequest(Builder builder) {
        this.sourceWalletId = builder.sourceWalletId;
        this.destinationWalletId = builder.destinationWalletId;
        this.amount = builder.amount;
        this.currency = builder.currency;
    }

    public String getSourceWalletId() { return sourceWalletId; }
    public String getDestinationWalletId() { return destinationWalletId; }
    public double getAmount() { return amount; }
    public String getCurrency() { return currency; }

    public static class Builder {
        private String sourceWalletId;
        private String destinationWalletId;
        private double amount;
        private String currency = "AED";

        public static Builder aTransfer() { return new Builder(); }
        public Builder withSource(String s) { this.sourceWalletId = s; return this; }
        public Builder withDestination(String d) { this.destinationWalletId = d; return this; }
        public Builder withAmount(double a) { this.amount = a; return this; }
        public Builder withCurrency(String c) { this.currency = c; return this; }
        public TransferRequest build() { return new TransferRequest(this); }
    }
}