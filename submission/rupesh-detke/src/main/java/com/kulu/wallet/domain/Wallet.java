package com.kulu.wallet.domain;

public record Wallet(String id, String currency, long balance, long version) {}
