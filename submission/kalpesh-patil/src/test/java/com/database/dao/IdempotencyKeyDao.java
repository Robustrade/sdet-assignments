package com.database.dao;

import com.database.DatabaseManager;

public class IdempotencyKeyDao {

	public int countRowsForKey(String idempotencyKey) {
		return DatabaseManager.querySingleValue(
				"SELECT count(*) AS n FROM idempotency_keys WHERE idempotency_key = ?", idempotencyKey,
				rs -> rs.getInt("n"), 0);
	}

	public String getState(String idempotencyKey) {
		return DatabaseManager.querySingleValue(
				"SELECT state FROM idempotency_keys WHERE idempotency_key = ?", idempotencyKey,
				rs -> rs.getString("state"), null);
	}

	public String getTransferId(String idempotencyKey) {
		return DatabaseManager.querySingleValue(
				"SELECT transfer_id FROM idempotency_keys WHERE idempotency_key = ?", idempotencyKey,
				rs -> {
					Object id = rs.getObject("transfer_id");
					return id == null ? null : id.toString();
				}, null);
	}
}
