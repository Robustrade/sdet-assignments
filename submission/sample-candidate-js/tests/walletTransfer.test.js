const axios = require('axios');

describe('Wallet Transfer Service', () => {
  const baseURL = 'http://localhost:3000'; // Adjust as needed

  test('happy path transfer', async () => {
    const response = await axios.post(`${baseURL}/transfers`, {
      source_wallet_id: 'wallet_001',
      destination_wallet_id: 'wallet_002',
      amount: 2500,
      currency: 'AED',
      reference: 'invoice_123'
    }, {
      headers: {
        'Idempotency-Key': 'test-key-123'
      }
    });

    expect(response.status).toBe(201);
    expect(response.data.status).toBe('completed');
  });

  // Add more tests
});