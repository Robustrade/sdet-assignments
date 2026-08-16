export function requireUrl(url: string | undefined, name: string): void {
  if (!url) {
    throw new Error(`Required configuration '${name}' is missing or empty`);
  }

  try {
    new URL(url);
  } catch (err) {
    throw new Error(`Invalid URL for '${name}': ${url}`, { cause: err });
  }
}
