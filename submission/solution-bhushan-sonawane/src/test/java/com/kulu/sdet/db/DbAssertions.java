package com.kulu.sdet.db;

import static org.assertj.core.api.Assertions.assertThat;

import com.kulu.sdet.util.DbUtil;

public class DbAssertions {

  public static void singleTransferExists() {
    int count = DbUtil.queryForInt("SELECT count(*) FROM transfers");
    assertThat(count).as("Expected exactly one transfer record").isEqualTo(1);
  }

  public static void noTransferExists() {
    int count = DbUtil.queryForInt("SELECT count(*) FROM transfers");
    assertThat(count).as("No transfer record should exist").isEqualTo(0);
  }

  public static void auditEventExists() {
    int count = DbUtil.queryForInt("SELECT count(*) FROM transfer_events");
    assertThat(count).as("Audit event must be recorded").isGreaterThan(0);
  }

  public static void outboxEventExistsOnce() {
    int count = DbUtil.queryForInt("SELECT count(*) FROM outbox_events");
    assertThat(count).as("Outbox event must be created exactly once").isEqualTo(1);
  }
}
