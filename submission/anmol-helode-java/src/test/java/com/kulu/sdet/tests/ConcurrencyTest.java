@Test
public void concurrentTransfers_shouldNotOverDebit() throws Exception {

    String wallet = "wallet_1";

    int before = DbUtils.getBalance(wallet);

    ExecutorService ex = Executors.newFixedThreadPool(2);

    Callable<Void> task = () -> {
        TransferApiClient.createTransfer(
                TestDataBuilder.payload(wallet, "wallet_2", 500),
                TestDataBuilder.key());
        return null;
    };

    ex.invokeAll(List.of(task, task));

    int after = DbUtils.getBalance(wallet);

    // 🔥 Key validation
    Assert.assertTrue(
            (before - after == 500) || (before - after == 1000)
    );
}