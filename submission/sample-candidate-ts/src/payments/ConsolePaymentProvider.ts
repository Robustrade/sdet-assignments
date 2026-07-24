import { ChargeRequest, ChargeResult, PaymentProvider } from "./PaymentProvider";

/**
 * Default PaymentProvider used when the app isn't given one explicitly.
 * Always succeeds; stands in for a real provider so the fixture runs
 * without network access. Tests should inject their own mock rather than
 * assert against this class.
 */
export class ConsolePaymentProvider implements PaymentProvider {
  async charge(request: ChargeRequest): Promise<ChargeResult> {
    return { outcome: "succeeded", providerChargeId: `ch_${request.reference}` };
  }
}
