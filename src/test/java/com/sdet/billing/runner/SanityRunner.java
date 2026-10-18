package com.sdet.billing.runner;

import org.testng.TestNG;

import java.util.List;

/**
 * Programmatic launcher for the sanity suite.
 * Run this main() from the IDE to execute smoke tests only.
 */
public class SanityRunner {

    public static void main(String[] args) {
        TestNG testNG = new TestNG();
        testNG.setTestSuites(List.of("testng-sanity.xml"));
        testNG.setVerbose(2);
        testNG.run();
        System.exit(testNG.getStatus());
    }
}
