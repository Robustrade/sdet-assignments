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