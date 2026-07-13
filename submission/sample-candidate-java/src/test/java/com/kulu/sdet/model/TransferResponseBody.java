package com.kulu.sdet.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import lombok.*;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonIgnoreProperties(ignoreUnknown = true)
public class TransferResponseBody {
    private int statusCode;
    private String id;
    private String sourceWalletId;
    private String destinationWalletId;
    private Long amount;
    private String currency;
    private String reference;
    private String status;
    private String idempotencyKey;
    private String createdAt;
    private String error;
}
