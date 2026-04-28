package com.wallet.assertions;

import io.restassured.response.Response;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Wraps a RestAssured Response and gives us a fluent way to assert on it.
 * Keeps the HTTP noise out of test methods so they stay readable.
 */
public class ApiAssertions {

    private final Response response;

    private ApiAssertions(Response response) {
        this.response = response;
    }

    public static ApiAssertions assertThatResponse(Response response) {
        return new ApiAssertions(response);
    }

    // ── Status codes ─────────────────────────────────────

    public ApiAssertions isCreated() {
        // 201 means the resource was created successfully
        assertThat(response.statusCode())
                .as("Expected 201 Created but got %d. Body: %s", response.statusCode(), response.body().asString())
                .isEqualTo(201);
        return this;
    }

    public ApiAssertions isOk() {
        // 200 for successful reads
        assertThat(response.statusCode())
                .as("Expected 200 OK but got %d. Body: %s", response.statusCode(), response.body().asString())
                .isEqualTo(200);
        return this;
    }

    public ApiAssertions isBadRequest() {
        // 400 = validation failure on the client side
        assertThat(response.statusCode())
                .as("Expected 400 Bad Request but got %d. Body: %s", response.statusCode(), response.body().asString())
                .isEqualTo(400);
        return this;
    }

    public ApiAssertions isUnprocessableEntity() {
        // 422 = request was valid but failed business logic (e.g. insufficient funds)
        assertThat(response.statusCode())
                .as("Expected 422 Unprocessable Entity but got %d. Body: %s", response.statusCode(), response.body().asString())
                .isEqualTo(422);
        return this;
    }

    public ApiAssertions isConflict() {
        // 409 = idempotency conflict — same key, different payload
        assertThat(response.statusCode())
                .as("Expected 409 Conflict but got %d. Body: %s", response.statusCode(), response.body().asString())
                .isEqualTo(409);
        return this;
    }

    public ApiAssertions isNotFound() {
        // 404 = resource doesn't exist
        assertThat(response.statusCode())
                .as("Expected 404 Not Found but got %d. Body: %s", response.statusCode(), response.body().asString())
                .isEqualTo(404);
        return this;
    }

    // ── Response body fields ─────────────────────────────

    public ApiAssertions hasTransferId() {
        // make sure there's actually an id in the response, not null or empty
        String id = response.jsonPath().getString("transferId");
        assertThat(id).as("transferId must not be blank").isNotBlank();
        return this;
    }

    public ApiAssertions hasStatus(String expectedStatus) {
        String actual = response.jsonPath().getString("status");
        assertThat(actual)
                .as("transfer status expected <%s> but was <%s>", expectedStatus, actual)
                .isEqualTo(expectedStatus);
        return this;
    }

    public ApiAssertions hasErrorMessageContaining(String fragment) {
        // checked case-insensitively so "Insufficient" and "insufficient" both pass
        String msg = response.jsonPath().getString("message");
        assertThat(msg)
                .as("error message should contain <%s> but was <%s>", fragment, msg)
                .containsIgnoringCase(fragment);
        return this;
    }

    public ApiAssertions hasBodyField(String jsonPath, Object expected) {
        Object actual = response.jsonPath().get(jsonPath);
        assertThat(actual)
                .as("Field <%s> expected <%s> but was <%s>", jsonPath, expected, actual)
                .isEqualTo(expected);
        return this;
    }

    public ApiAssertions transferIdEquals(String expected) {
        assertThat(response.jsonPath().getString("transferId"))
                .as("transferId mismatch").isEqualTo(expected);
        return this;
    }

    /** Grabs the transfer id out of the response — handy when you need it for a follow-up call. */
    public String extractTransferId() {
        return response.jsonPath().getString("transferId");
    }

    // expose the raw response if someone really needs it
    public Response getResponse() {
        return response;
    }
}

