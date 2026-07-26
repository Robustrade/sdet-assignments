package com.api.tests;

import org.testng.annotations.BeforeMethod;
import org.testng.annotations.BeforeSuite;

import com.api.services.TransferService;
import com.api.utils.TestEnvironmentManager;
import com.database.dao.IdempotencyKeyDao;
import com.database.dao.OutboxEventDao;
import com.database.dao.TransferDao;
import com.database.dao.TransferEventDao;
import com.database.dao.WalletDao;

import io.restassured.RestAssured;

/**
 * Base for all API tests. Boots the shared test environment once per suite and resets the
 * database before every test method so no test can observe another test's rows.
 */
public class BaseAPITest {

	protected TransferService transferService;
	protected WalletDao walletDao;
	protected TransferDao transferDao;
	protected IdempotencyKeyDao idempotencyKeyDao;
	protected TransferEventDao transferEventDao;
	protected OutboxEventDao outboxEventDao;

	@BeforeSuite(description = "Starting embedded PostgreSQL and the wallet service fixture")
	public void startEnvironment() {
		RestAssured.baseURI = TestEnvironmentManager.getInstance().getBaseUri();
	}

	@BeforeMethod(description = "Resetting database state and instantiating services and DAOs")
	public void setUpBase() {
		TestEnvironmentManager.getInstance().resetDatabase();
		RestAssured.baseURI = TestEnvironmentManager.getInstance().getBaseUri();
		transferService = new TransferService();
		walletDao = new WalletDao();
		transferDao = new TransferDao();
		idempotencyKeyDao = new IdempotencyKeyDao();
		transferEventDao = new TransferEventDao();
		outboxEventDao = new OutboxEventDao();
	}
}
