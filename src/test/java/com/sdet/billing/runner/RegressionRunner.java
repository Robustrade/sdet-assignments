package com.sdet.billing.runner;

import org.testng.TestNG;

import java.util.List;

/**
 * Programmatic launcher for the regression suite.
 * Run this main() from the IDE to execute all regression tests without Maven.
 * The XML file is the single source of truth for group/class configuration.
 */
public class RegressionRunner {

    public static void main(String[] args) {
        TestNG testNG = new TestNG();
        testNG.setTestSuites(List.of("testng-regression.xml"));
        testNG.setVerbose(2);
        testNG.run();
        System.exit(testNG.getStatus());
    }
}
