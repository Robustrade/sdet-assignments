package com.api.utils;

import java.io.IOException;
import java.io.InputStream;
import java.util.Properties;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;

public class ConfigManager {

	private static final Properties prop = new Properties();
	private static final String PATH = "config/config.properties";
	private static final Logger LOGGER = LogManager.getLogger(ConfigManager.class);

	private ConfigManager() {
	}

	static {
		LOGGER.info("Loading test configuration from {}", PATH);
		InputStream input = Thread.currentThread().getContextClassLoader().getResourceAsStream(PATH);
		if (input == null) {
			throw new RuntimeException("Cannot find the config file at the path " + PATH);
		}
		try {
			prop.load(input);
		} catch (IOException e) {
			throw new RuntimeException("Failed to load config file " + PATH, e);
		}
	}

	public static String getProperty(String key) {
		return prop.getProperty(key);
	}

	public static int getIntProperty(String key) {
		return Integer.parseInt(prop.getProperty(key));
	}

	public static long getLongProperty(String key) {
		return Long.parseLong(prop.getProperty(key));
	}
}
