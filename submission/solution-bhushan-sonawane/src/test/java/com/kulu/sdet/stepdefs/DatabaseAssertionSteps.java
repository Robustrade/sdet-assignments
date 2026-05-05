package com.kulu.sdet.stepdefs;

import com.kulu.sdet.db.DbAssertions;
import io.cucumber.java.en.Then;

public class DatabaseAssertionSteps {

  @Then("exactly one transfer record should exist")
  public void exactlyOneTransferRecordExists() {
    DbAssertions.singleTransferExists();
  }

  @Then("no transfer record should exist")
  public void noTransferRecordExists() {
    DbAssertions.noTransferExists();
  }

  @Then("audit log entry should exist")
  public void auditLogEntryExists() {
    DbAssertions.auditEventExists();
  }

  @Then("outbox event should exist once")
  public void outboxEventExistsOnce() {
    DbAssertions.outboxEventExistsOnce();
  }
}
