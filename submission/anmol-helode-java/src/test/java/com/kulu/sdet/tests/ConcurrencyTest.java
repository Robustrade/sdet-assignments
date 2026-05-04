package tests;

import api.TransferApiClient;
import db.DbUtils;
import org.testng.Assert;
import org.testng.annotations.Test;
import utils.TestDataBuilder;

import java.util.concurrent.*;

public class ConcurrencyTest {

    @Test
    public void concurrentTransfer() throws Exception {

        int before = DbUtils.getBalance("wallet_1");

        ExecutorService ex = Executors.newFixedThreadPool(2);

        Callable<Void> task = () -> {
            TransferApiClient.createTransfer(
                    TestDataBuilder.payload("wallet_1","wallet_2",500),
                    TestDataBuilder.key());
            return null;
        };

        ex.invokeAll(java.util.List.of(task, task));

        int after = DbUtils.getBalance("wallet_1");

        Assert.assertTrue(before - after == 500 || before - after == 1000);
    }
}