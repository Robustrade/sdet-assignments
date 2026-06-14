package com.kulu.sdet.service.model;

import java.util.Map;

public record ServiceResult(int statusCode, Map<String, Object> body) {}
