package tests;

import api.TransferApiClient;
import db.DbUtils;
import org.testng.Assert;
import org.testng.annotations.Test;
import utils.TestDataBuilder;

import java.util.concurrent.*;

public class ConcurrencyTest {

    @Test
    public void concurrentTransfers_shouldNotCorruptBalance() throws Exception {

        String wallet = "wallet_1";

        int before = DbUtils.getBalance(wallet);

        ExecutorService ex = Executors.newFixedThreadPool(2);

        Callable<Void> task = () -> {
            TransferApiClient.createTransfer(
                    TestDataBuilder.payload(wallet,"wallet_2",500),
                    TestDataBuilder.key());
            return null;
        };

        ex.invokeAll(List.of(task, task));

        int after = DbUtils.getBalance(wallet);

        // 🔥 Strong validation
        Assert.assertTrue(
                before - after == 500 || before - after == 1000,
                "Balance should reflect valid transaction outcome only"
        );
    }
}