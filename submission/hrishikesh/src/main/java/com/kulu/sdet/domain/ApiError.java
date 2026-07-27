package com.kulu.sdet.domain;

import com.fasterxml.jackson.annotation.JsonProperty;

/** Machine-readable error envelope returned by the API for all 4xx responses. */
public record ApiError(@JsonProperty("code") String code, @JsonProperty("message") String message) {

  public static ApiError of(String code, String message) {
    return new ApiError(code, message);
  }
}
