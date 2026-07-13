package com.kulu.sdet.client;

import com.kulu.sdet.model.TransferRequestBody;
import com.kulu.sdet.model.TransferResponseBody;
import io.restassured.http.ContentType;
import io.restassured.response.Response;

import static io.restassured.RestAssured.*;

public class TransferClient {

    public TransferResponseBody create(TransferRequestBody body) {
        Response response = given()
                .contentType(ContentType.JSON)
                .body(body)
                .when()
                .post("/transfers");

        return toResponseBody(response);
    }

    public TransferResponseBody getById(String id) {
        Response response = given()
                .when()
                .get("/transfers/{id}", id);

        return toResponseBody(response);
    }

    private TransferResponseBody toResponseBody(Response response) {
        TransferResponseBody transferResponseBody = response.as(TransferResponseBody.class);
        transferResponseBody.setStatusCode(response.getStatusCode());

        return transferResponseBody;
    }

}
