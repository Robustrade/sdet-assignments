import dotenv from "dotenv";

dotenv.config();

function getRequiredEnv(name: string): string {
  const value = process.env[name];

  if (!value || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function getOptionalEnv(name: string, defaultValue: string): string {
  return process.env[name]?.trim() || defaultValue;
}

function getDatabasePort(): number {
  const port = Number(getOptionalEnv("DB_PORT", "5432"));

  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error("DB_PORT must be a valid port number.");
  }

  return port;
}

export const env = {
  apiBaseUrl: getRequiredEnv("API_BASE_URL"),

  testEnvironment: getOptionalEnv("TEST_ENV", "local"),

  database: {
    get host(): string {
      return getOptionalEnv("DB_HOST", "localhost");
    },

    get port(): number {
      return getDatabasePort();
    },

    get name(): string {
      return getRequiredEnv("DB_NAME");
    },

    get user(): string {
      return getRequiredEnv("DB_USER");
    },

    get password(): string {
      return getRequiredEnv("DB_PASSWORD");
    }
  }
};
