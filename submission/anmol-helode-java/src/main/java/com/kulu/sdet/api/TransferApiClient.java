package api;

import io.restassured.RestAssured;
import io.restassured.response.Response;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import utils.ConfigReader;

public class TransferApiClient {

    private static final Logger log = LoggerFactory.getLogger(TransferApiClient.class);
    private static final String BASE_URL = ConfigReader.get("base.url");

    public static Response createTransfer(String payload, String key) {

        log.info("POST /transfers with key={}", key);

        return RestAssured
                .given()
                .baseUri(BASE_URL)
                .header("Content-Type", "application/json")
                .header("Idempotency-Key", key)
                .body(payload)
                .post("/transfers");
    }

    public static Response getTransfer(String id) {
        return RestAssured
                .given()
                .baseUri(BASE_URL)
                .get("/transfers/" + id);
    }
}