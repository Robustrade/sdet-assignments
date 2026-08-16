import dotenv from 'dotenv';

dotenv.config();

export const secrets = {
  apiKey: process.env.API_TOKEN || '',
  username: process.env.USERNAME || 'admin',
  password: process.env.PASSWORD || 'password',
};
