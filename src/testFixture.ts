import { BillingService } from "./service";
import { FakePaymentProvider } from "./provider";
import { ApiClient } from "./apiClient";

export class TestFixture {
  readonly provider = new FakePaymentProvider();
  readonly service = new BillingService(undefined, this.provider);
  readonly api = new ApiClient(this.service.app);

  reset(): void {
    this.service.repository.clear();
    this.provider.calls.splice(0);
    this.provider.outcome = "success";
  }
}
