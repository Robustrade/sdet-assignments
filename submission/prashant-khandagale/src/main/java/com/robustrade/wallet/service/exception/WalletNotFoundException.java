package com.robustrade.wallet.service.exception;

/** Source or destination wallet does not exist. Maps to HTTP 404. */
public class WalletNotFoundException extends RuntimeException {
    public WalletNotFoundException(String message) {
        super(message);
    }
}
