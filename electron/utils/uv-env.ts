import { logger } from './logger';

let loggedOnce = false;

export async function shouldOptimizeNetwork(): Promise<boolean> {
  return false;
}

export async function getUvMirrorEnv(): Promise<Record<string, string>> {
  return {};
}

export async function warmupNetworkOptimization(): Promise<void> {
  if (loggedOnce) return;
  loggedOnce = true;
  logger.info('UV mirror override disabled; using official upstream sources.');
}
