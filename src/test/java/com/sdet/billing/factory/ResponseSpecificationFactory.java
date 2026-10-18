package com.sdet.billing.factory;

import io.restassured.builder.ResponseSpecBuilder;
import io.restassured.http.ContentType;
import io.restassured.specification.ResponseSpecification;

import static org.hamcrest.Matchers.notNullValue;

/**
 * Factory pattern — builds pre-configured RestAssured ResponseSpecification objects.
 *
 * Tests use these as the .then().spec(...) argument so status-code + shape assertions
 * are declared once and reused across the suite.
 */
public final class ResponseSpecificationFactory {

    private ResponseSpecificationFactory() {}

    /** 200 OK with JSON body */
    public static ResponseSpecification ok200() {
        return new ResponseSpecBuilder()
            .expectStatusCode(200)
            .expectContentType(ContentType.JSON)
            .build();
    }

    /** 201 Created — subscription creation */
    public static ResponseSpecification created201() {
        return new ResponseSpecBuilder()
            .expectStatusCode(201)
            .expectContentType(ContentType.JSON)
            .expectBody("id",     notNullValue())
            .expectBody("status", notNullValue())
            .build();
    }

    /** 400 Bad Request — validation error */
    public static ResponseSpecification badRequest400() {
        return new ResponseSpecBuilder()
            .expectStatusCode(400)
            .expectContentType(ContentType.JSON)
            .expectBody("error", notNullValue())
            .build();
    }

    /** 401 Unauthorized — bad/missing webhook signature */
    public static ResponseSpecification unauthorized401() {
        return new ResponseSpecBuilder()
            .expectStatusCode(401)
            .build();
    }

    /** 404 Not Found */
    public static ResponseSpecification notFound404() {
        return new ResponseSpecBuilder()
            .expectStatusCode(404)
            .expectContentType(ContentType.JSON)
            .expectBody("error", notNullValue())
            .build();
    }

    /** 409 Conflict — invalid state transition */
    public static ResponseSpecification conflict409() {
        return new ResponseSpecBuilder()
            .expectStatusCode(409)
            .expectContentType(ContentType.JSON)
            .expectBody("error", notNullValue())
            .build();
    }
}
