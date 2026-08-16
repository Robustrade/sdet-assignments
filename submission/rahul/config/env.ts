import dotenv from 'dotenv';

dotenv.config();

export const env = {
  baseUrl: process.env.BASE_URL || 'http://localhost:3000',
  environment: process.env.ENVIRONMENT || 'local',
  apiToken: process.env.API_TOKEN || '',
};
