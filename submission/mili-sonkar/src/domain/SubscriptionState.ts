export type SubscriptionState =
    | 'trialing'
    | 'active'
    | 'past_due'
    | 'canceled';

export enum Trigger {
    PaymentSucceeded = 'PaymentSucceeded',
    PaymentFailed = 'PaymentFailed',
    CancelRequested = 'CancelRequested',
    RetrySucceeded = 'RetrySucceeded',
    RetriesExhausted = 'RetriesExhausted',
}