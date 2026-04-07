/**
 * Lightpanda process spawner.
 *
 * Owns the lightpanda child process lifecycle for ibr-managed modes
 * (one-shot and daemon-owned). Connect-only mode (BROWSER_CDP_URL set)
 * does not use this.
 *
 * Pseudocode (see T-0029 description + spec §"Lightpanda spawner config
 * passthrough" for full details):
 *
 *   spawn({ binPath, host, port, obeyRobots }):
 *     actualPort = port || findFreePort()  // 3 retries on EADDRINUSE
 *     args = ['serve', '--host', host, '--port', String(actualPort)]
 *     if (obeyRobots) args.push('--obey-robots')
 *     env = { ...process.env, LIGHTPANDA_DISABLE_TELEMETRY: 'true' }
 *     if (LIGHTPANDA_TELEMETRY === 'true') delete env.LIGHTPANDA_DISABLE_TELEMETRY
 *     proc = childProcess.spawn(binPath, args, { stdio, env })
 *     ring = captureStdio(proc, 1_048_576)
 *     await waitForCdpReady('ws://'+host+':'+actualPort+'/json/version')
 *     return { wsEndpoint, kill, proc, ringBuffer }
 *
 * Track: adopt-lightpanda
 * Implemented by: T-0029
 */

// TODO(T-0029)
export async function spawn({ binPath, host = '127.0.0.1', port = 0, obeyRobots = false }) {
  throw new Error('src/browser/launchers/lightpanda-spawner.js not yet implemented');
}
