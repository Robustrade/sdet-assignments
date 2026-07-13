package com.kulu.sdet;

import io.restassured.RestAssured;
import org.testng.annotations.BeforeClass;

public class BaseTest {

    @BeforeClass(alwaysRun = true)
    void setUp() {
        RestAssured.baseURI = "http://localhost:8080"; // Adjust as needed
    }

}
