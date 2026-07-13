package com.kulu.sdet.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import lombok.*;

import static org.testng.Assert.*;

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

    public void assertCreated(TransferRequestBody requestBody) {
        assertNotNull(this.getId(), "transfer id should be present");
        assertEquals(this.getStatus(), "completed", "status should be completed");
        assertEquals(this.getSourceWalletId(), requestBody.getSourceWalletId());
        assertEquals(this.destinationWalletId, requestBody.getDestinationWalletId());
        assertEquals(this.getAmount().longValue(), requestBody.getAmount().longValue());
        assertEquals(this.getCurrency(), requestBody.getCurrency());
        assertNotNull(this.getCreatedAt(), "created_at should be present");
    }

    public void assertCreated(TransferRequestBody requestBody, String idempotencyKey) {
        assertCreated(requestBody);
        assertEquals(this.getIdempotencyKey(), idempotencyKey, "Idempotency-Key not matched");
    }
}
