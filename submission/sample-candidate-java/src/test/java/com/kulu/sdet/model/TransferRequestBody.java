package com.kulu.sdet.model;

import lombok.*;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class TransferRequestBody {
    private String sourceWalletId;
    private String destinationWalletId;
    private Long amount;
    private String currency;
    private String reference;
}
