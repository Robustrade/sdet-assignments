export interface WebhookEventRepository {

  save(
    eventId: string
  ): void;

  exists(
    eventId: string
  ): boolean;

}