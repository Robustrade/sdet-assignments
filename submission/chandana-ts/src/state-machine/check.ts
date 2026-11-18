import { getNextStatus } from './subscription-state';

console.log(
  'Trial payment success:',
  getNextStatus('trialing', 'PAYMENT_SUCCEEDED')
);

console.log(
  'Recurring payment failure:',
  getNextStatus('active', 'PAYMENT_FAILED')
);

try {
  getNextStatus('canceled', 'PAYMENT_SUCCEEDED');
} catch (error) {
  console.log('Invalid transition rejected:', (error as Error).message);
}