/** @portOnly Each host uses its own content storage, independently of pilot saves. */
import { offlineInstall } from './questStorage.ts';
import { serverInstall } from './fetchSource.ts';

export async function startupInstall() {
  if (new URLSearchParams(window.location.search).get('native') === '1') {
    // A migrated browser profile may still contain an OPFS install pointer.
    // The standalone host's verified private content is always authoritative.
    const install = await serverInstall();
    if (!install) throw Error('Local game data missing. Complete the app installation before starting.');
    return install;
  }
  return await offlineInstall() ?? await serverInstall();
}
