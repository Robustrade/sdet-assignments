package com.kulu.sdet.model;

import lombok.*;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class WalletResponseBody {
    private int statusCode;
    private String id;
    private Long balance;
    private String currency;
    private String error;
}
