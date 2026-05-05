package com.kulu.sdet.hooks;

import com.kulu.sdet.util.DbUtil;
import io.cucumber.java.Before;

public class TestHooks {

  @Before
  public void cleanDatabase() {
    // Order matters due to FK constraints
    DbUtil.execute("DELETE FROM outbox_events");
    DbUtil.execute("DELETE FROM transfer_events");
    DbUtil.execute("DELETE FROM idempotency_keys");
    DbUtil.execute("DELETE FROM transfers");
  }
}
