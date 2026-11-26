import crypto from "crypto"
import { ChargeRequest, PaymentGateway } from "../../fixture/PaymentGateway"
import { WEBHOOK_SECRET } from "../../fixture/server"
import { clear } from "console"

export class MockPaymentGateway implements PaymentGateway {
    readonly recordedCharges: ChargeRequest[] = []
    paymentResult = "success"

    setPaymentSuccess() { this.paymentResult = "success" }
    setPaymentDeclined() { this.paymentResult = "decline" }
    setPaymentTimeout() { this.paymentResult = "timeout" }

    clearHistory() {
        this.recordedCharges.length = 0
        this.paymentResult = "success"
    }

    createSignature(rawBody: string) {
        return crypto.createHmac("sha256", WEBHOOK_SECRET).update(rawBody).digest("hex")
    }

    async charge(request: ChargeRequest) {
        this.recordedCharges.push(request)
        if (this.paymentResult === "timeout") throw new Error("ETIMEDOUT")
        if (this.paymentResult === "decline") return { status: "declined", declineReason: "insufficient_funds" }
        return { status: "succeeded", transactionId: "txn_" + crypto.randomBytes(4).toString("hex") }
    }
}
 