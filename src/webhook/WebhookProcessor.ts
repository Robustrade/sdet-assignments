import { WebhookEventRepository }
from "../repositories/WebhookEventRepository";

export class WebhookProcessor {

  constructor(
    private repository:
      WebhookEventRepository
  ) {}

  process(
    eventId: string
  ): boolean {

    if (
      this.repository.exists(
        eventId
      )
    ) {
      return false;
    }

    this.repository.save(
      eventId
    );

    return true;
  }

}