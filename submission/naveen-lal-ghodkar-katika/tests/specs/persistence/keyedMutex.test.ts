import { KeyedMutex } from '../../../src/support/KeyedMutex';

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('KeyedMutex', () => {
  it('runs work for the same key strictly one after another, in arrival order', async () => {
    const mutex = new KeyedMutex();
    const log: string[] = [];
    const job = (name: string) => async () => {
      log.push(`${name}:start`);
      await tick();
      await tick();
      log.push(`${name}:end`);
    };

    await Promise.all([mutex.runExclusive('k', job('a')), mutex.runExclusive('k', job('b')), mutex.runExclusive('k', job('c'))]);

    expect(log).toEqual(['a:start', 'a:end', 'b:start', 'b:end', 'c:start', 'c:end']);
  });

  it('lets different keys run at the same time', async () => {
    const mutex = new KeyedMutex();
    const log: string[] = [];
    const job = (name: string) => async () => {
      log.push(`${name}:start`);
      await tick();
      log.push(`${name}:end`);
    };

    await Promise.all([mutex.runExclusive('k1', job('a')), mutex.runExclusive('k2', job('b'))]);

    expect(log).toEqual(['a:start', 'b:start', 'a:end', 'b:end']);
  });

  it('returns the work result and releases the key when the work throws', async () => {
    const mutex = new KeyedMutex();

    await expect(mutex.runExclusive('k', async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    const next = await mutex.runExclusive('k', async () => 'still works');

    expect(next).toBe('still works');
  });

  it('does not keep finished keys around', async () => {
    const mutex = new KeyedMutex();

    await mutex.runExclusive('k1', async () => undefined);
    await Promise.all([mutex.runExclusive('k2', tick), mutex.runExclusive('k2', tick)]);

    expect(mutex.activeKeys).toBe(0);
  });
});
