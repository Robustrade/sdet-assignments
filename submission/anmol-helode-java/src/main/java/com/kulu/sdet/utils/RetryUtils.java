package utils;

public class RetryUtils {

    public static void retry(Runnable r, int attempts) {
        int count = 0;
        while (count < attempts) {
            try {
                r.run();
                return;
            } catch (Exception e) {
                count++;
                if (count == attempts) throw e;
            }
        }
    }

    @Test
    public void retryAfterTimeout_shouldNotDuplicateTransfer() throws Exception {

        String payload = TestDataBuilder.payload("wallet_1","wallet_2",100);
        String key = TestDataBuilder.key();

        // First attempt (simulate response lost)
        TransferApiClient.createTransfer(payload, key);

        // Retry
        Response retry = TransferApiClient.createTransfer(payload, key);

        retry.then().statusCode(200);

        // Verify only one transfer exists
        int count = DbUtils.getTransferCountByKey(key);
        Assert.assertEquals(count, 1);
    }
}