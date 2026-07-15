
const { randomUUID } = require("crypto");

const walletRepository = require("../repositories/walletRepository");
const transferRepository = require("../repositories/transferRepository");
const auditRepository = require("../repositories/auditRepository");
const idempotencyRepository = require("../repositories/idempotencyRepository");

async function transferMoney(request) {

    const existingRequest =
        await idempotencyRepository.getByKey(request.idempotencyKey);

    if (existingRequest) {
        return {
            id: existingRequest.transfer_id,
            status: "completed",
            message: "Duplicate request"
        };
    }

    const sourceWallet =
        await walletRepository.getWalletById(request.source_wallet_id);

    const destinationWallet =
        await walletRepository.getWalletById(request.destination_wallet_id);

    if (!sourceWallet || !destinationWallet) {
        throw new Error("Wallet not found");
    }

    if (sourceWallet.id === destinationWallet.id) {
        throw new Error("Source and destination wallets cannot be the same");
    }

    if (request.amount <= 0) {
        throw new Error("Amount must be greater than zero");
    }

    if (sourceWallet.balance < request.amount) {
        throw new Error("Insufficient balance");
    }

    const transfer = {
        id: randomUUID(),
        sourceWalletId: sourceWallet.id,
        destinationWalletId: destinationWallet.id,
        amount: request.amount,
        currency: request.currency,
        reference: request.reference,
        status: "completed"
    };

    await walletRepository.updateBalances(
        sourceWallet.id,
        sourceWallet.balance - request.amount,
        destinationWallet.id,
        destinationWallet.balance + request.amount
    );

    await transferRepository.createTransfer(transfer);

    await auditRepository.createAuditEvent(
        transfer.id,
        "TRANSFER_COMPLETED"
    );

    await idempotencyRepository.saveKey(
        request.idempotencyKey,
        transfer.id
    );

    return transfer;
}

module.exports = {
    transferMoney
};