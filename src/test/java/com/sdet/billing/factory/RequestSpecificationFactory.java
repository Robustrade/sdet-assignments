package com.sdet.billing.factory;

import com.sdet.billing.config.TestApiConfig;
import io.qameta.allure.restassured.AllureRestAssured;
import io.restassured.builder.RequestSpecBuilder;
import io.restassured.http.ContentType;
import io.restassured.specification.RequestSpecification;

/**
 * Factory pattern — builds pre-configured RestAssured RequestSpecification objects.
 *
 * Every spec includes:
 *   - base URI and port from TestApiConfig
 *   - JSON content-type / accept headers
 *   - AllureRestAssured filter (auto-attaches request + response bodies to the Allure report)
 *
 * Tests call given().spec(RequestSpecificationFactory.jsonApi()) rather than repeating
 * these details on every request.
 */
public final class RequestSpecificationFactory {

    private RequestSpecificationFactory() {}

    /**
     * Standard JSON API spec — used for all subscription CRUD calls.
     */
    public static RequestSpecification jsonApi() {
        TestApiConfig cfg = TestApiConfig.get();
        return new RequestSpecBuilder()
            .setBaseUri(cfg.getBaseUrl())
            .setContentType(ContentType.JSON)
            .setAccept(ContentType.JSON)
            .addFilter(new AllureRestAssured())
            .build();
    }

    /**
     * Webhook spec — raw body is posted as plain text so the HMAC check works on
     * the exact bytes sent; the signature header is added per-call by the test.
     */
    public static RequestSpecification webhook() {
        TestApiConfig cfg = TestApiConfig.get();
        return new RequestSpecBuilder()
            .setBaseUri(cfg.getBaseUrl())
            .setContentType(ContentType.JSON)
            .addFilter(new AllureRestAssured())
            .build();
    }

    /**
     * Admin/internal spec — carries an internal token header.
     * Extend for services that have an admin API or health check.
     */
    public static RequestSpecification admin() {
        TestApiConfig cfg = TestApiConfig.get();
        return new RequestSpecBuilder()
            .setBaseUri(cfg.getBaseUrl())
            .setContentType(ContentType.JSON)
            .setAccept(ContentType.JSON)
            .addHeader("X-Internal-Token", "test-internal-token")
            .addFilter(new AllureRestAssured())
            .build();
    }
}
