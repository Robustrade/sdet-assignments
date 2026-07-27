const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

class ApiHelper {
  constructor(baseURL = process.env.BASE_URL || 'http://localhost:3000') {
    this.baseURL = baseURL;
    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: 10000,
      validateStatus: () => true,
    });
  }

  async get(endpoint, config = {}) {
    try {
      const response = await this.client.get(endpoint, config);
      return {
        status: response.status,
        data: response.data,
        headers: response.headers,
      };
    } catch (error) {
      return this._handleError(error);
    }
  }

  async post(endpoint, data = {}, config = {}) {
    try {
      const response = await this.client.post(endpoint, data, config);
      return {
        status: response.status,
        data: response.data,
        headers: response.headers,
      };
    } catch (error) {
      return this._handleError(error);
    }
  }

  async put(endpoint, data = {}, config = {}) {
    try {
      const response = await this.client.put(endpoint, data, config);
      return {
        status: response.status,
        data: response.data,
        headers: response.headers,
      };
    } catch (error) {
      return this._handleError(error);
    }
  }

  async patch(endpoint, data = {}, config = {}) {
    try {
      const response = await this.client.patch(endpoint, data, config);
      return {
        status: response.status,
        data: response.data,
        headers: response.headers,
      };
    } catch (error) {
      return this._handleError(error);
    }
  }

  async delete(endpoint, config = {}) {
    try {
      const response = await this.client.delete(endpoint, config);
      return {
        status: response.status,
        data: response.data,
        headers: response.headers,
      };
    } catch (error) {
      return this._handleError(error);
    }
  }

  async createTransfer(transferData, idempotencyKey = null) {
    const headers = {};
    if (idempotencyKey) {
      headers['Idempotency-Key'] = idempotencyKey;
    }

    return await this.post('/transfers', transferData, { headers });
  }

  async getTransfer(transferId) {
    return await this.get(`/transfers/${transferId}`);
  }

  async getWallet(walletId) {
    return await this.get(`/wallets/${walletId}`);
  }

  async createWallet(walletData) {
    return await this.post('/wallets', walletData);
  }

  async updateWalletBalance(walletId, balance) {
    return await this.put(`/wallets/${walletId}/balance`, { balance });
  }

  generateIdempotencyKey() {
    return uuidv4();
  }

  _handleError(error) {
    if (error.response) {
      return {
        status: error.response.status,
        data: error.response.data,
        headers: error.response.headers,
        error: error.message,
      };
    } else if (error.request) {
      return {
        status: 0,
        data: null,
        headers: {},
        error: 'No response received from server',
      };
    } else {
      return {
        status: 0,
        data: null,
        headers: {},
        error: error.message,
      };
    }
  }

  setAuthToken(token) {
    this.client.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  }

  clearAuthToken() {
    delete this.client.defaults.headers.common['Authorization'];
  }

  setCustomHeader(key, value) {
    this.client.defaults.headers.common[key] = value;
  }

  clearCustomHeader(key) {
    delete this.client.defaults.headers.common[key];
  }
}

module.exports = ApiHelper;
