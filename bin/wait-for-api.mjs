import { setTimeout } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

export async function waitForApi({
  url = 'http://127.0.0.1:4242/api/health',
  timeoutMs = 300000,
  retryMs = 250,
} = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(Math.min(2000, Math.max(1, deadline - Date.now()))) });
      const health = response.ok ? await response.json() : null;
      if (health?.service === 'claw-lens' && health.status === 'ok') return;
    } catch { /* Backend can still be ingesting sessions or restarting. */ }
    await setTimeout(Math.min(retryMs, Math.max(0, deadline - Date.now())));
  }
  throw new Error(`Timed out waiting for the claw-lens API at ${url}. Check the backend output above.`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  console.log('Waiting for the claw-lens API before starting the dashboard...');
  try {
    await waitForApi();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
