package com.kulu.utils;

import java.io.InputStream;
import java.util.Properties;

public class Config {
    private static final Properties properties = new Properties();

    static {
        try (InputStream input = Config.class.getClassLoader().getResourceAsStream("application.properties")) {
            if (input == null) {
                throw new RuntimeException("Sorry, unable to find application.properties");
            }
            properties.load(input);
        } catch (Exception ex) {
            throw new RuntimeException("Error loading configuration", ex);
        }
    }

    public static String get(String key) {
        // Allows system properties (like CI pipeline args) to override the file
        return System.getProperty(key, properties.getProperty(key));
    }
}