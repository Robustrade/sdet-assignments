@Test
public void retryAfterClientTimeout_shouldNotDuplicateTransfer() throws Exception {

    String payload = TestDataBuilder.payload("wallet_1","wallet_2",100);
    String key = TestDataBuilder.key();

    // First request (assume response lost)
    TransferApiClient.createTransfer(payload, key);

    // Retry
    Response retry = TransferApiClient.createTransfer(payload, key);

    retry.then().statusCode(200);

    // Validate only ONE transfer exists
    int count = DbUtils.transferCountByKey(key);
    Assert.assertEquals(count, 1);
}