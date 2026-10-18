package com.sdet.billing.listener;

import com.sdet.billing.config.TestApiConfig;
import lombok.extern.slf4j.Slf4j;
import org.testng.ISuite;
import org.testng.ISuiteListener;
import org.testng.ISuiteResult;

/**
 * Slack notifier — ISuiteListener so it fires once per suite with aggregate counts.
 *
 * Implementation is intentionally left as a stub/no-op for this demo.
 * To enable real Slack notifications:
 *   1. Set slack.webhook.url in config.properties (or -Dslack.webhook.url=...)
 *   2. Replace the TODO block in notify() with an HTTP POST using Java's HttpClient
 *
 * When the URL is blank the listener logs to console only — CI stays green.
 */
@Slf4j
public class SlackNotifierListener implements ISuiteListener {

    @Override
    public void onStart(ISuite suite) {
        notify(String.format(":rocket: *Suite starting*: `%s`", suite.getName()));
    }

    @Override
    public void onFinish(ISuite suite) {
        int passed = 0, failed = 0, skipped = 0;
        for (ISuiteResult result : suite.getResults().values()) {
            passed  += result.getTestContext().getPassedTests().getAllResults().size();
            failed  += result.getTestContext().getFailedTests().getAllResults().size();
            skipped += result.getTestContext().getSkippedTests().getAllResults().size();
        }
        notify(String.format(
            ":white_check_mark: *Suite finished*: `%s` | Passed: *%d* | Failed: *%d* | Skipped: *%d*",
            suite.getName(), passed, failed, skipped
        ));
    }

    // ── Private ───────────────────────────────────────────────────────────────

    private void notify(String message) {
        String webhookUrl = TestApiConfig.get().getSlackWebhookUrl();

        if (webhookUrl == null || webhookUrl.isBlank()) {
            log.info("[SlackNotifier NO-OP] {}", message);
            return;
        }

        // TODO: replace with real Slack HTTP POST when URL is configured
        // Example (Java 11+ HttpClient):
        //
        // String payload = "{\"text\": \"" + message.replace("\"", "\\\"") + "\"}";
        // HttpClient.newHttpClient().send(
        //     HttpRequest.newBuilder(URI.create(webhookUrl))
        //         .POST(HttpRequest.BodyPublishers.ofString(payload))
        //         .header("Content-Type", "application/json")
        //         .build(),
        //     HttpResponse.BodyHandlers.discarding()
        // );

        log.info("[SlackNotifier STUB] Would POST to Slack: {}", message);
    }
}
