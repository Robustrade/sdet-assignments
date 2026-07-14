package com.kulu.sdet.model;

import lombok.*;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ErrorResponseBody {

    private int statusCode;
    private String timestamp;
    private int status;
    private String error;
    private String message;
    private String path;

}