/**
 * Playwright launch() launcher — existing codepath, lightly refactored.
 *
 * Used for all `chromium-launch` kind backends:
 *   chrome, msedge, brave, chromium, arc, comet
 *
 * Returns BrowserHandle with close() that kills the Chromium subprocess
 * (Playwright default behavior).
 *
 * Track: adopt-lightpanda
 * Implemented by: T-0025
 */

// TODO(T-0025)
export async function launch({ executablePath, channel, launchOptions = {} }) {
  throw new Error('src/browser/launchers/playwright-launch.js not yet implemented');
}
