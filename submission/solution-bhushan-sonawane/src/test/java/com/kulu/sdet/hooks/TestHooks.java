package com.kulu.sdet.hooks;

import com.kulu.sdet.util.DbUtil;
import io.cucumber.java.Before;

public class TestHooks {

  @Before
  public void cleanDatabase() {
    DbUtil.execute(
        "TRUNCATE TABLE "
            + "outbox_events, "
            + "transfer_events, "
            + "idempotency_keys, "
            + "transfers, "
            + "wallets "
            + "CASCADE");
  }
}
