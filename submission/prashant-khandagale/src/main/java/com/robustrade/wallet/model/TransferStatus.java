package com.robustrade.wallet.model;

/**
 * Lifecycle states for a transfer.
 *
 * Kept intentionally small for this fixture:
 *  - COMPLETED: funds moved, this is a terminal success state.
 *  - REJECTED: business rule failed (e.g. insufficient balance) before any
 *              money moved. Terminal failure state. No wallet mutation happened.
 *
 * A production system would likely also have PENDING / PROCESSING states for
 * async/multi-step transfers, but this fixture processes transfers
 * synchronously in a single DB transaction, so those states aren't needed
 * to demonstrate the required invariants.
 */
public enum TransferStatus {
    COMPLETED,
    REJECTED
}
