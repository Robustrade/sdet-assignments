package com.sdet.billing.config;

import lombok.Getter;
import lombok.extern.slf4j.Slf4j;

import java.io.InputStream;
import java.util.Properties;

/**
 * Central configuration for the test suite.
 * Values are resolved in priority order:
 *   1. System property  (-Dbase.url=...)
 *   2. Environment variable (BASE_URL=...)
 *   3. config.properties on the test classpath
 */
@Slf4j
@Getter
public class TestApiConfig {

    private static final TestApiConfig INSTANCE = new TestApiConfig();

    private final String baseUrl;
    private final String webhookSecret;
    private final int connectTimeoutMs;
    private final int readTimeoutMs;
    private final String slackWebhookUrl;

    private TestApiConfig() {
        Properties props = loadProperties();
        baseUrl          = resolve("base.url",           "BASE_URL",           props, "http://localhost:8080");
        webhookSecret    = resolve("webhook.secret",     "WEBHOOK_SECRET",     props, "test-hmac-secret-key-256bit");
        connectTimeoutMs = Integer.parseInt(resolve("connect.timeout.ms", "CONNECT_TIMEOUT_MS", props, "5000"));
        readTimeoutMs    = Integer.parseInt(resolve("read.timeout.ms",    "READ_TIMEOUT_MS",    props, "10000"));
        slackWebhookUrl  = resolve("slack.webhook.url",  "SLACK_WEBHOOK_URL",  props, "");
        log.info("TestApiConfig loaded — baseUrl={}", baseUrl);
    }

    public static TestApiConfig get() {
        return INSTANCE;
    }

    private Properties loadProperties() {
        Properties props = new Properties();
        try (InputStream is = getClass().getClassLoader().getResourceAsStream("config.properties")) {
            if (is != null) {
                props.load(is);
            }
        } catch (Exception e) {
            log.warn("config.properties not found on classpath — using defaults");
        }
        return props;
    }

    private String resolve(String sysProp, String envVar, Properties props, String defaultValue) {
        String val = System.getProperty(sysProp);
        if (val != null && !val.isBlank()) return val;
        val = System.getenv(envVar);
        if (val != null && !val.isBlank()) return val;
        val = props.getProperty(sysProp);
        if (val != null && !val.isBlank()) return val;
        return defaultValue;
    }
}
