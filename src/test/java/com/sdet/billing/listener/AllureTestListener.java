package com.sdet.billing.listener;

import io.qameta.allure.Allure;
import lombok.extern.slf4j.Slf4j;
import org.testng.ITestContext;
import org.testng.ITestListener;
import org.testng.ITestResult;

/**
 * Allure TestNG listener — adds extra contextual labels to every test case.
 *
 * Note: allure-testng ships its own AllureTestNg listener registered via Java SPI
 * (META-INF/services/org.testng.ITestNGListener) — it fires automatically and handles
 * core Allure lifecycle (pass/fail/skip, attachments).
 *
 * This class adds supplementary tagging (suite name, class name) and is explicitly
 * declared in the TestNG XML so it is visible to readers.  Do NOT also list the
 * allure-testng built-in listener in XML — that would double-register it.
 */
@Slf4j
public class AllureTestListener implements ITestListener {

    @Override
    public void onTestStart(ITestResult result) {
        Allure.label("testClass", result.getTestClass().getName());
        Allure.label("suite",     result.getTestContext().getSuite().getName());
        log.debug("[Allure] Test started: {}", result.getMethod().getMethodName());
    }

    @Override
    public void onTestSuccess(ITestResult result) {
        log.info("[Allure] PASS — {}", result.getMethod().getMethodName());
    }

    @Override
    public void onTestFailure(ITestResult result) {
        // Attach the failure message as an Allure text attachment for easier triage
        Throwable cause = result.getThrowable();
        if (cause != null) {
            Allure.addAttachment("Failure reason", cause.getMessage() != null ? cause.getMessage() : cause.toString());
        }
        log.error("[Allure] FAIL — {}: {}", result.getMethod().getMethodName(),
            cause != null ? cause.getMessage() : "unknown");
    }

    @Override
    public void onTestSkipped(ITestResult result) {
        log.warn("[Allure] SKIP — {}", result.getMethod().getMethodName());
    }

    @Override
    public void onStart(ITestContext context) {
        log.info("[Allure] Suite starting: {}", context.getSuite().getName());
    }

    @Override
    public void onFinish(ITestContext context) {
        log.info("[Allure] Suite finished: {} | pass={} fail={} skip={}",
            context.getSuite().getName(),
            context.getPassedTests().size(),
            context.getFailedTests().size(),
            context.getSkippedTests().size());
    }
}
