import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const sources = vi.hoisted(() => ({ offline: vi.fn(), server: vi.fn() }));
vi.mock('../../src/app/questStorage.ts', () => ({ offlineInstall: sources.offline }));
vi.mock('../../src/app/fetchSource.ts', () => ({ serverInstall: sources.server }));
import { startupInstall } from '../../src/app/startupInstall.ts';
beforeEach(() => { vi.resetAllMocks(); });
afterEach(() => vi.unstubAllGlobals());

it('boots the native host even when migrated browser storage points to an absent OPFS install', async () => {
  vi.stubGlobal('window', { location: { search: '?native=1' } });
  sources.offline.mockRejectedValue(Error('OPFS install missing'));
  const content = { host: 'native-private-content' };
  sources.server.mockResolvedValue(content);
  expect(await startupInstall()).toBe(content);
  expect(sources.offline).not.toHaveBeenCalled();
});

it('keeps the offline browser install preferred and reports corrupt browser content', async () => {
  vi.stubGlobal('window', { location: { search: '' } });
  const content = { host: 'browser-opfs' };
  sources.offline.mockResolvedValue(content);
  expect(await startupInstall()).toBe(content);
  expect(sources.server).not.toHaveBeenCalled();
  sources.offline.mockRejectedValue(Error('OPFS install missing'));
  await expect(startupInstall()).rejects.toThrow('OPFS install missing');
});

it('uses the PC content host for browser development but requires native content for an APK', async () => {
  vi.stubGlobal('window', { location: { search: '' } });
  sources.offline.mockResolvedValue(null);
  const content = { host: 'development' };
  sources.server.mockResolvedValue(content);
  expect(await startupInstall()).toBe(content);
  sources.server.mockResolvedValue(null);
  vi.stubGlobal('window', { location: { search: '?native=1' } });
  await expect(startupInstall()).rejects.toThrow('Local game data missing');
});
