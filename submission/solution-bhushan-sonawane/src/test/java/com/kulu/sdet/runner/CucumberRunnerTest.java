package com.kulu.sdet.runner;

import io.cucumber.junit.Cucumber;
import io.cucumber.junit.CucumberOptions;
import org.junit.runner.RunWith;

@RunWith(Cucumber.class)
@CucumberOptions(
    features = "src/test/resources/features",
    glue = "com.kulu.sdet",
    plugin = {"pretty", "html:target/cucumber.html"},
    monochrome = true)
public class CucumberRunnerTest {}
