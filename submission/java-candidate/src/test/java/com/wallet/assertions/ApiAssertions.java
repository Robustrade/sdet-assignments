package com.wallet.assertions;

import io.restassured.response.Response;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Fluent API-level assertion helpers.
 * Captures intent clearly without mixing assertions with HTTP concerns inside tests.
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
        assertThat(response.statusCode())
                .as("Expected 201 Created but got %d. Body: %s", response.statusCode(), response.body().asString())
                .isEqualTo(201);
        return this;
    }

    public ApiAssertions isOk() {
        assertThat(response.statusCode())
                .as("Expected 200 OK but got %d. Body: %s", response.statusCode(), response.body().asString())
                .isEqualTo(200);
        return this;
    }

    public ApiAssertions isBadRequest() {
        assertThat(response.statusCode())
                .as("Expected 400 Bad Request but got %d. Body: %s", response.statusCode(), response.body().asString())
                .isEqualTo(400);
        return this;
    }

    public ApiAssertions isUnprocessableEntity() {
        assertThat(response.statusCode())
                .as("Expected 422 Unprocessable Entity but got %d. Body: %s", response.statusCode(), response.body().asString())
                .isEqualTo(422);
        return this;
    }

    public ApiAssertions isConflict() {
        assertThat(response.statusCode())
                .as("Expected 409 Conflict but got %d. Body: %s", response.statusCode(), response.body().asString())
                .isEqualTo(409);
        return this;
    }

    public ApiAssertions isNotFound() {
        assertThat(response.statusCode())
                .as("Expected 404 Not Found but got %d. Body: %s", response.statusCode(), response.body().asString())
                .isEqualTo(404);
        return this;
    }

    // ── Response body fields ─────────────────────────────

    public ApiAssertions hasTransferId() {
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

    /** Returns the transfer id from the response for further use in tests. */
    public String extractTransferId() {
        return response.jsonPath().getString("transferId");
    }

    public Response getResponse() {
        return response;
    }
}

