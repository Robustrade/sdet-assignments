package tests;

import api.TransferApiClient;
import assertions.TransferAssertions;
import db.DbUtils;
import org.testng.annotations.Test;
import io.restassured.response.Response;
import utils.TestDataBuilder;

public class TransferE2ETest {

    @Test
    public void successfulTransfer() throws Exception {

        String src = "wallet_1";
        String dest = "wallet_2";

        int beforeSrc = DbUtils.getBalance(src);
        int beforeDest = DbUtils.getBalance(dest);

        String payload = TestDataBuilder.payload(src, dest, 100);

        Response res = TransferApiClient.createTransfer(payload, TestDataBuilder.key());

        res.then().statusCode(200);

        int afterSrc = DbUtils.getBalance(src);
        int afterDest = DbUtils.getBalance(dest);

        TransferAssertions.assertBalanceInvariant(
                beforeSrc, beforeDest, afterSrc, afterDest, 100);
    }
}