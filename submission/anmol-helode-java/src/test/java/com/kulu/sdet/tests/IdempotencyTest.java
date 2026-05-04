package tests;

import api.TransferApiClient;
import db.DbUtils;
import org.testng.Assert;
import org.testng.annotations.Test;
import io.restassured.response.Response;
import utils.TestDataBuilder;

public class IdempotencyTest {

    @Test
    public void sameRequestSameKey() throws Exception {

        String payload = TestDataBuilder.payload("wallet_1","wallet_2",100);
        String key = TestDataBuilder.key();

        Response r1 = TransferApiClient.createTransfer(payload, key);
        Response r2 = TransferApiClient.createTransfer(payload, key);

        Assert.assertEquals(r1.asString(), r2.asString());
        Assert.assertTrue(DbUtils.idempotencyExists(key));
    }
}