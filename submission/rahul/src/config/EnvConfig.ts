import dotenv from 'dotenv';

dotenv.config();

export class EnvConfig {
  static get baseUrl(): string {
    const value = process.env.BASE_URL;

    if (!value) {
      throw new Error('BASE_URL is not defined in environment variables.');
    }

    return value;
  }

  static get apiToken(): string {
    return process.env.API_TOKEN ?? '';
  }

  static get environment(): string {
    return process.env.ENVIRONMENT ?? 'local';
  }
}
