@Test
public void retryAfterResponseLoss_shouldBeSafe() throws Exception {

    String payload = TestDataBuilder.payload("wallet_1","wallet_2",100);
    String key = TestDataBuilder.key();

    // First attempt (assume response lost)
    TransferApiClient.createTransfer(payload, key);

    // Retry
    Response retry = TransferApiClient.createTransfer(payload, key);

    retry.then().statusCode(200);

    // 🔥 verify only one transfer persisted
    int count = DbUtils.transferCountByKey(key);
    Assert.assertEquals(count, 1);
}
@Test
public void retryAfterTimeout_shouldNotDuplicateTransfer() throws Exception {

    String payload = TestDataBuilder.payload("wallet_1","wallet_2",100);
    String key = TestDataBuilder.key();

    // First attempt
    TransferApiClient.createTransfer(payload, key);

    // Retry
    Response retry = TransferApiClient.createTransfer(payload, key);

    retry.then().statusCode(200);

    // Validate single persistence
    int count = DbUtils.getTransferCountByKey(key);
    Assert.assertEquals(count, 1);
}

@Test
public void retryAfterTimeout_shouldNotDuplicateTransfer() throws Exception {

    String payload = TestDataBuilder.payload("wallet_1","wallet_2",100);
    String key = TestDataBuilder.key();

    // First attempt (simulate response loss)
    TransferApiClient.createTransfer(payload, key);

    // Retry
    Response retry = TransferApiClient.createTransfer(payload, key);

    retry.then().statusCode(200);

    // Validate only one DB entry
    int count = DbUtils.getTransferCountByKey(key);
    Assert.assertEquals(count, 1);
}