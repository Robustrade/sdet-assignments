const { randomUUID } = require('crypto');

const SOURCE_WALLET = 'wallet_001';
const DESTINATION_WALLET = 'wallet_002';
const EMPTY_WALLET = 'wallet_003';

module.exports = {

    SOURCE_WALLET,
    DESTINATION_WALLET,
    EMPTY_WALLET,

    validTransfer(overrides = {}) {
        return {
            source_wallet_id: SOURCE_WALLET,
            destination_wallet_id: DESTINATION_WALLET,
            amount: 100,
            currency: 'AED',
            reference: `REF-${randomUUID()}`,
            ...overrides
        };
    },

    invalidCurrencyTransfer() {
        return this.validTransfer({
            currency: 'INR'
        });
    },

    zeroAmountTransfer() {
        return this.validTransfer({
            amount: 0
        });
    },

    insufficientBalanceTransfer() {
        return {
            source_wallet_id: EMPTY_WALLET,
            destination_wallet_id: DESTINATION_WALLET,
            amount: 100,
            currency: 'AED',
            reference: `REF-${randomUUID()}`
        };
    }

};