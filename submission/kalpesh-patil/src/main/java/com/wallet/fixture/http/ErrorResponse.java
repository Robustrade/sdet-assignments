package com.wallet.fixture.http;

/** JSON error body shape for all 4xx/5xx responses. */
record ErrorResponse(String errorCode, String errorMessage) {}
