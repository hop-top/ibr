/**
 * GitHub Releases provider.
 *
 * Resolves a channel spec → { tag, assetUrl, sha256?, publishedAt }
 *
 * Stable channel: newest non-prerelease, tag normalized (strip optional 'v').
 * Nightly: rolling 'nightly' tag.
 *
 * Arch/os asset mapping:
 *   darwin-arm64 → aarch64-macos
 *   darwin-x64   → x86_64-macos
 *   linux-x64    → x86_64-linux
 *   linux-arm64  → aarch64-linux
 *   win32        → hard fail (unsupported upstream)
 *
 * Track: adopt-lightpanda
 * Implemented by: T-0027
 */

// TODO(T-0027)
export async function resolveChannel(repo, channel, channels) {
  throw new Error('src/browser/providers/github.js not yet implemented');
}
