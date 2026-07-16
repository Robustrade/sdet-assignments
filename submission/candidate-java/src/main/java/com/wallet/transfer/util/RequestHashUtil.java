package com.wallet.transfer.util;

import com.wallet.transfer.dto.TransferRequest;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

public class RequestHashUtil {
  private RequestHashUtil() {}

  public static String hash(TransferRequest request) {
    String canonical = canonicalize(request);
    try {
      MessageDigest digest = MessageDigest.getInstance("SHA-256");
      byte[] hash = digest.digest(canonical.getBytes(StandardCharsets.UTF_8));
      return bytesToHex(hash);
    } catch (NoSuchAlgorithmException e) {
      throw new IllegalStateException("SHA-256 not available", e);
    }
  }

  private static String canonicalize(TransferRequest request) {
    return String.join(
        "|",
        request.sourceWalletId(),
        request.destinationWalletId(),
        request.amount().toPlainString(),
        request.currency(),
        request.reference());
  }

  private static String bytesToHex(byte[] bytes) {
    StringBuilder sb = new StringBuilder(bytes.length * 2);
    for (byte b : bytes) {
      sb.append(String.format("%02x", b));
    }
    return sb.toString();
  }
}
