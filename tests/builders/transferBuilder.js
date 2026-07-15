function buildTransfer(overrides = {}) {
    return {
        source_wallet_id: "wallet_001",
        destination_wallet_id: "wallet_002",
        amount: 500,
        currency: "AED",
        reference: `invoice-${Date.now()}`,
        ...overrides
    };
}

module.exports = {
    buildTransfer
};