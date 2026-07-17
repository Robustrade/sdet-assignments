package com.kulu.fixtures;

import com.github.tomakehurst.wiremock.WireMockServer;
import com.github.tomakehurst.wiremock.client.WireMock;
import static com.github.tomakehurst.wiremock.client.WireMock.*;
import static com.github.tomakehurst.wiremock.core.WireMockConfiguration.options;

public class MockApiServer {

    private static WireMockServer wireMockServer;
    private static final int PORT = 8080;

    // Start the local API server on port 8080
    public static void start() {
        if (wireMockServer == null) {
            wireMockServer = new WireMockServer(options().port(PORT));
            wireMockServer.start();
            WireMock.configureFor("localhost", PORT);
        }
    }

    // Stop the server after test suites finish
    public static void stop() {
        if (wireMockServer != null && wireMockServer.isRunning()) {
            wireMockServer.stop();
        }
    }

    // Clear all stubs between tests to ensure state isolation
    public static void reset() {
        if (wireMockServer != null) {
            wireMockServer.resetAll();
        }
    }

    // --- Stub Definitions for our Scenarios ---

    public static void stubSuccessfulTransfer() {
        stubFor(post(urlEqualTo("/transfers"))
                .willReturn(aResponse()
                        .withStatus(200)
                        .withHeader("Content-Type", "application/json")
                        .withBody("{ \"status\": \"SUCCESS\", \"message\": \"Transfer completed successfully\" }")));
    }

    public static void stubInsufficientFunds() {
        stubFor(post(urlEqualTo("/transfers"))
                .willReturn(aResponse()
                        .withStatus(400)
                        .withHeader("Content-Type", "application/json")
                        .withBody("{ \"status\": \"FAILED\", \"message\": \"Insufficient funds in source wallet\" }")));
    }

    public static void stubDuplicateIdempotencyRequest() {
        stubFor(post(urlEqualTo("/transfers"))
                .withHeader("Idempotency-Key", matching(".*"))
                .willReturn(aResponse()
                        .withStatus(200)
                        .withHeader("Content-Type", "application/json")
                        .withBody("{ \"status\": \"SUCCESS\", \"message\": \"Transfer already processed\" }")));
    }
}