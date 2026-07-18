package com.database.model;

public class OutboxEventDBModel {

	private final String aggregateType;
	private final String aggregateId;
	private final String eventType;
	private final String payload;
	private final boolean published;

	public OutboxEventDBModel(String aggregateType, String aggregateId, String eventType, String payload,
			boolean published) {
		this.aggregateType = aggregateType;
		this.aggregateId = aggregateId;
		this.eventType = eventType;
		this.payload = payload;
		this.published = published;
	}

	public String getAggregateType() {
		return aggregateType;
	}

	public String getAggregateId() {
		return aggregateId;
	}

	public String getEventType() {
		return eventType;
	}

	public String getPayload() {
		return payload;
	}

	public boolean isPublished() {
		return published;
	}

	@Override
	public String toString() {
		return "OutboxEventDBModel [aggregateType=" + aggregateType + ", aggregateId=" + aggregateId + ", eventType="
				+ eventType + ", payload=" + payload + ", published=" + published + "]";
	}
}
