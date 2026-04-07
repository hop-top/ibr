/**
 * Playwright connectOverCDP launcher — used for all `cdp-server` backends.
 *
 * Lightpanda is the first tenant. Any browser exposing a CDP websocket
 * endpoint can use this launcher.
 *
 * close() disconnects but does NOT kill the remote process. Process
 * ownership stays with whoever spawned it (user, daemon, or one-shot
 * ibr wrapper — managed by lifecycle dispatch in resolver.js).
 *
 * Track: adopt-lightpanda
 * Implemented by: T-0028
 */

// TODO(T-0028)
export async function connect({ wsEndpoint, contextOptions = {} }) {
  throw new Error('src/browser/launchers/playwright-connect.js not yet implemented');
}
