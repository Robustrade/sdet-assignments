package com.sdet.billing.base;

import com.sdet.billing.config.TestApiConfig;
import com.sdet.billing.factory.RequestSpecificationFactory;
import com.sdet.billing.listener.AllureTestListener;
import com.sdet.billing.listener.SlackNotifierListener;
import io.qameta.allure.restassured.AllureRestAssured;
import io.restassured.RestAssured;
import io.restassured.specification.RequestSpecification;
import lombok.extern.slf4j.Slf4j;
import org.testng.annotations.BeforeClass;
import org.testng.annotations.Listeners;

/**
 * Base class for all test classes.
 *
 * Responsibilities:
 *   - Read configuration (base URL, timeouts) from TestApiConfig once per class
 *   - Configure RestAssured global defaults (baseURI, filters)
 *   - Expose pre-built request specs (baseSpec, webhookSpec) to subclasses
 *   - Declare suite-level listeners for Allure reporting and Slack notifications
 *
 * Subclasses extend this and call given().spec(baseSpec) without repeating setup.
 */
@Slf4j
@Listeners({AllureTestListener.class, SlackNotifierListener.class})
public abstract class BaseTest {

    protected RequestSpecification baseSpec;
    protected RequestSpecification webhookSpec;

    @BeforeClass(alwaysRun = true)
    public void setUpRestAssured() {
        TestApiConfig cfg = TestApiConfig.get();

        RestAssured.baseURI = cfg.getBaseUrl();
        RestAssured.filters(new AllureRestAssured());

        baseSpec    = RequestSpecificationFactory.jsonApi();
        webhookSpec = RequestSpecificationFactory.webhook();

        log.info("RestAssured configured — baseURI={}", cfg.getBaseUrl());
    }
}
