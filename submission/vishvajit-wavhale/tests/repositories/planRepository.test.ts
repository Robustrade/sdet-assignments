
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach
} from 'vitest';

import { SqliteDatabase } from '../../src/database/Database.js';
import { initializeSchema } from '../../src/database/DatabaseSchema.js';
import { DatabaseSeeder } from '../../src/database/DatabaseSeeder.js';
import { PlanRepository } from '../../src/repositories/PlanRepository.js';

describe('PlanRepository', () => {
  let database: SqliteDatabase;
  let planRepository: PlanRepository;

  beforeEach(() => {
    database = new SqliteDatabase();

    initializeSchema(database.connection);

    const seeder = new DatabaseSeeder(database.connection);
    seeder.seed();

    planRepository = new PlanRepository(database.connection);
  });

  afterEach(() => {
    database.close();
  });

  it('should find a plan by ID', () => {
    const plan = planRepository.findById('plan_basic');

    expect(plan).not.toBeNull();
    expect(plan?.name).toBe('basic');
    expect(plan?.price_cents).toBe(1900);
  });

  it('should find a plan by name', () => {
    const plan = planRepository.findByName('pro');

    expect(plan).not.toBeNull();
    expect(plan?.id).toBe('plan_pro');
    expect(plan?.trial_days).toBe(14);
  });

  it('should return null for an unknown plan ID', () => {
    const plan = planRepository.findById('unknown_plan');

    expect(plan).toBeNull();
  });

  it('should return null for an unknown plan name', () => {
    const plan = planRepository.findByName('enterprise');

    expect(plan).toBeNull();
  });

  it('should return all plans ordered by price', () => {
    const plans = planRepository.findAll();

    expect(plans).toHaveLength(2);
    expect(plans[0].name).toBe('basic');
    expect(plans[1].name).toBe('pro');
  });
});
