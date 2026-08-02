/**
 * Minimal logger used in tests and the small service.
 * This keeps logging usage consistent and easy to replace later.
 */
export const logger = {
  info: (...args: any[]) => console.log('[info]', ...args),
  warn: (...args: any[]) => console.warn('[warn]', ...args),
  error: (...args: any[]) => console.error('[error]', ...args),
  debug: (...args: any[]) => console.debug('[debug]', ...args)
};

export default logger;
