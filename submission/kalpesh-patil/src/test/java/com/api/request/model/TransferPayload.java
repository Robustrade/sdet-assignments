package com.api.request.model;

import com.api.utils.ConfigManager;
import com.api.utils.DataGeneratorUtil;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Request body for POST /transfers. Null fields are left out of the JSON, so negative tests just
 * pass null for the field they want missing.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public class TransferPayload {

	@JsonProperty("source_wallet_id")
	private String sourceWalletId;

	@JsonProperty("destination_wallet_id")
	private String destinationWalletId;

	@JsonProperty("amount")
	private Long amount;

	@JsonProperty("currency")
	private String currency;

	@JsonProperty("reference")
	private String reference;

	public TransferPayload(String sourceWalletId, String destinationWalletId, Long amount, String currency,
			String reference) {
		this.sourceWalletId = sourceWalletId;
		this.destinationWalletId = destinationWalletId;
		this.amount = amount;
		this.currency = currency;
		this.reference = reference;
	}

	/** Common case: default currency from config, generated reference. */
	public TransferPayload(String sourceWalletId, String destinationWalletId, long amount) {
		this(sourceWalletId, destinationWalletId, amount, ConfigManager.getProperty("default.currency"),
				DataGeneratorUtil.getReference());
	}

	public String getSourceWalletId() {
		return sourceWalletId;
	}

	public String getDestinationWalletId() {
		return destinationWalletId;
	}

	public Long getAmount() {
		return amount;
	}

	public String getCurrency() {
		return currency;
	}

	public String getReference() {
		return reference;
	}

	@Override
	public String toString() {
		return "TransferPayload [sourceWalletId=" + sourceWalletId + ", destinationWalletId=" + destinationWalletId
				+ ", amount=" + amount + ", currency=" + currency + ", reference=" + reference + "]";
	}
}
