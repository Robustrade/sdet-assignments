import dotenv from 'dotenv';
import { environments } from './environments';

dotenv.config();

const environment =
  process.env.ENVIRONMENT || 'local';

if (!(environment in environments)) {
  throw new Error(
    `Unsupported environment: ${environment}`
  );
}

export const config =
  environments[environment as keyof typeof environments];

export const apiToken =
  process.env.API_TOKEN || '';