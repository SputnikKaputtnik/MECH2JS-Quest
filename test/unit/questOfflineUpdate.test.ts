import { afterEach, expect, it, vi } from 'vitest';
import { installOfflineShell } from '../../src/app/questStorage.ts';

afterEach(() => vi.unstubAllGlobals());

it('activates the installed worker even before registration.waiting is assigned', async () => {
  const worker = Object.assign(new EventTarget(), {
    state: 'installing',
    postMessage: vi.fn(() => {
      queueMicrotask(() => { worker.state = 'activated'; worker.dispatchEvent(new Event('statechange')); });
    }),
  });
  const registration = { installing: worker, waiting: null, active: {}, update: async () => {} };
  vi.stubGlobal('navigator', { serviceWorker: { register: async () => registration, ready: Promise.resolve(registration) } });
  vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ id: 'new-build' }) })));
  vi.stubGlobal('caches', { open: async () => ({ match: async () => new Response('index') }) });
  const installing = installOfflineShell();
  await new Promise(resolve => setTimeout(resolve, 0));
  worker.state = 'installed';
  worker.dispatchEvent(new Event('statechange'));
  await installing;
  expect(worker.postMessage).toHaveBeenCalledWith('activate-installed-build');
  expect(worker.state).toBe('activated');
});
