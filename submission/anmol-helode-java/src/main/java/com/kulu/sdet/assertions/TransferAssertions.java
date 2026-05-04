public static void assertTransferInvariant(
        int beforeSrc,
        int beforeDest,
        int afterSrc,
        int afterDest,
        int amount) {

    // debit
    Assert.assertEquals(afterSrc, beforeSrc - amount);

    // credit
    Assert.assertEquals(afterDest, beforeDest + amount);
    Assert.assertEquals(
            beforeSrc + beforeDest,
            afterSrc + afterDest
    );

    int before = DbUtils.getBalance("wallet_1");

    TransferApiClient.createTransfer(payload, key)
            .then().statusCode(400);

    int after = DbUtils.getBalance("wallet_1");

    Assert.assertEquals(before, after);
}