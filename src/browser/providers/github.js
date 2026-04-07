/**
 * GitHub Releases provider.
 *
 * Resolves a channel spec → { version, assetUrl, sha256?, requireChecksum, tag, publishedAt }
 *
 * Stable channel: newest non-prerelease, tag normalized (strip optional 'v').
 * Nightly: rolling 'nightly' tag — version = `nightly-YYYY-MM-DD` from published_at.
 * Latest: alias for stable (recursive, with cycle guard).
 * Exact version: caller passes 'v0.2.6' or '0.2.8' as channelName.
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

const ARCH_OS_MAP = {
  'darwin-arm64': 'aarch64-macos',
  'darwin-x64': 'x86_64-macos',
  'linux-x64': 'x86_64-linux',
  'linux-arm64': 'aarch64-linux',
};

const MAX_ALIAS_DEPTH = 5;

function archOsKey(platform, arch) {
  return `${platform}-${arch}`;
}

function substituteAssetPattern(pattern, platform, arch) {
  const key = archOsKey(platform, arch);
  const slug = ARCH_OS_MAP[key];
  if (!slug) {
    throw new Error(
      `github provider: unsupported platform/arch combination "${key}". ` +
        `Supported: ${Object.keys(ARCH_OS_MAP).join(', ')}`,
    );
  }
  return pattern.replace('{arch}-{os}', slug);
}

function stripV(tag) {
  return typeof tag === 'string' && /^v\d/.test(tag) ? tag.slice(1) : tag;
}

function isoToDateStamp(iso) {
  // 2026-04-06T12:34:56Z → 2026-04-06
  if (!iso) return 'unknown';
  const m = String(iso).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : 'unknown';
}

async function fetchJson(url, fetchFn, { retryOn429 = true } = {}) {
  let res;
  try {
    res = await fetchFn(url, {
      headers: { Accept: 'application/vnd.github+json' },
    });
  } catch (err) {
    throw new Error(`github provider: fetch ${url} failed: ${err.message}`);
  }
  if (res.status === 429 && retryOn429) {
    await new Promise((r) => setTimeout(r, 500));
    return fetchJson(url, fetchFn, { retryOn429: false });
  }
  if (res.status === 404) {
    const err = new Error(`github provider: 404 for ${url}`);
    err.status = 404;
    throw err;
  }
  if (!res.ok) {
    throw new Error(`github provider: ${url} returned ${res.status}`);
  }
  return await res.json();
}

async function fetchText(url, fetchFn, { retryOn429 = true } = {}) {
  let res;
  try {
    res = await fetchFn(url);
  } catch (err) {
    throw new Error(`github provider: fetch ${url} failed: ${err.message}`);
  }
  if (res.status === 429 && retryOn429) {
    await new Promise((r) => setTimeout(r, 500));
    return fetchText(url, fetchFn, { retryOn429: false });
  }
  if (!res.ok) {
    throw new Error(`github provider: ${url} returned ${res.status}`);
  }
  return await res.text();
}

function findBinaryAsset(release, channelEntry, platform, arch) {
  const pattern = channelEntry.assetPattern;
  if (!pattern) {
    throw new Error(
      `github provider: channel entry missing assetPattern for resolver "${channelEntry.resolver}"`,
    );
  }
  const expected = substituteAssetPattern(pattern, platform, arch);
  const assets = release.assets || [];

  // Prefer exact match to avoid false-positives on variants like
  // `lightpanda-aarch64-macos-debug` or `...-signed`. Fall back to an
  // extension-suffix match (`<expected>.tar.gz`, `.zip`, etc.) so the
  // resolver still works if upstream starts shipping archived binaries.
  const exact = assets.find((a) => a.name === expected);
  const extSuffix = exact
    ? null
    : assets.find((a) => a.name && a.name.startsWith(expected + '.'));
  const match = exact ?? extSuffix;

  if (!match) {
    const names = assets.map((a) => a.name).join(', ') || '(none)';
    throw new Error(
      `github provider: no asset matching "${expected}" in release ${release.tag_name}. Assets: ${names}`,
    );
  }
  return match;
}

async function findChecksum(release, binaryAsset, fetchFn) {
  const assets = release.assets || [];
  const binName = binaryAsset.name;

  // 1. <binaryName>.sha256
  const sidecarSha = assets.find((a) => a.name === `${binName}.sha256`);
  if (sidecarSha) {
    const text = await fetchText(sidecarSha.browser_download_url, fetchFn);
    return parseShaLine(text, binName);
  }

  // 2. <binaryName>.sha256sum
  const sidecarShaSum = assets.find((a) => a.name === `${binName}.sha256sum`);
  if (sidecarShaSum) {
    const text = await fetchText(sidecarShaSum.browser_download_url, fetchFn);
    return parseShaLine(text, binName);
  }

  // 3. SHA256SUMS / sha256sums.txt — multi-line file
  const sumsFile = assets.find(
    (a) => a.name === 'SHA256SUMS' || a.name === 'sha256sums.txt',
  );
  if (sumsFile) {
    const text = await fetchText(sumsFile.browser_download_url, fetchFn);
    return parseShaSums(text, binName);
  }

  return null;
}

function parseShaLine(text, binName) {
  // Either "<hex>" or "<hex>  <name>"
  const trimmed = String(text).trim();
  if (!trimmed) return null;
  const firstLine = trimmed.split(/\r?\n/)[0];
  const parts = firstLine.split(/\s+/);
  const hex = parts[0];
  if (/^[a-f0-9]{64}$/i.test(hex)) return hex.toLowerCase();
  return null;
}

function parseShaSums(text, binName) {
  const lines = String(text).split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length < 2) continue;
    const hex = parts[0];
    // Last column is the filename (may have * prefix from binary mode).
    const name = parts[parts.length - 1].replace(/^\*/, '');
    if (name === binName || name.endsWith(`/${binName}`)) {
      if (/^[a-f0-9]{64}$/i.test(hex)) return hex.toLowerCase();
    }
  }
  return null;
}

async function resolveTag(repo, tag, fetchFn) {
  const url = `https://api.github.com/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`;
  try {
    return await fetchJson(url, fetchFn);
  } catch (err) {
    if (err.status === 404) {
      throw new Error(`github provider: release tag '${tag}' not found in ${repo}`);
    }
    throw err;
  }
}

async function tryResolveTag(repo, tag, fetchFn) {
  // Variant of resolveTag that returns null on 404 instead of throwing.
  const url = `https://api.github.com/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`;
  try {
    return await fetchJson(url, fetchFn);
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

async function resolveNewestNonPrerelease(repo, fetchFn) {
  const url = `https://api.github.com/repos/${repo}/releases?per_page=30`;
  const list = await fetchJson(url, fetchFn);
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error(`github provider: no releases for ${repo}`);
  }
  const stable = list.filter((r) => r && r.prerelease === false);
  if (stable.length === 0) {
    throw new Error(`github provider: no non-prerelease releases for ${repo}`);
  }
  stable.sort((a, b) => {
    const ta = Date.parse(a.published_at || '') || 0;
    const tb = Date.parse(b.published_at || '') || 0;
    return tb - ta;
  });
  return stable[0];
}

/**
 * Resolve a channel spec to a concrete release artifact descriptor.
 *
 * @param {string} repo - 'owner/name'
 * @param {string} channelName - 'stable' | 'nightly' | 'latest' | exact-version
 * @param {object} channelsConfig - entry.releases.channels
 * @param {object} [opts]
 * @param {Function} [opts.fetchFn] - injected fetch (for tests)
 * @param {string} [opts.platform]
 * @param {string} [opts.arch]
 * @returns {Promise<{version, assetUrl, sha256, requireChecksum, tag, publishedAt}>}
 */
export async function resolveChannel(
  repo,
  channelName,
  channelsConfig,
  {
    fetchFn = globalThis.fetch,
    platform = process.platform,
    arch = process.arch,
  } = {},
) {
  if (platform === 'win32') {
    throw new Error('Lightpanda is not supported on Windows');
  }
  if (!ARCH_OS_MAP[archOsKey(platform, arch)]) {
    throw new Error(
      `github provider: unsupported platform/arch combination "${archOsKey(platform, arch)}". ` +
        `Supported: ${Object.keys(ARCH_OS_MAP).join(', ')}`,
    );
  }
  if (typeof fetchFn !== 'function') {
    throw new Error('github provider: fetchFn is required (no global fetch available)');
  }

  // Follow alias chain.
  let resolvedName = channelName;
  let channelEntry = channelsConfig ? channelsConfig[resolvedName] : undefined;
  let depth = 0;
  while (channelEntry && channelEntry.resolver === 'alias') {
    if (depth >= MAX_ALIAS_DEPTH) {
      throw new Error(
        `github provider: alias chain too deep (>${MAX_ALIAS_DEPTH}) starting from "${channelName}"`,
      );
    }
    const next = channelEntry.aliasOf;
    if (!next || !channelsConfig[next]) {
      throw new Error(
        `github provider: alias "${resolvedName}" points to missing channel "${next}"`,
      );
    }
    resolvedName = next;
    channelEntry = channelsConfig[resolvedName];
    depth++;
  }

  // If no channel entry found, treat channelName as exact version.
  let release;
  let resolverKind;
  if (!channelEntry) {
    resolverKind = 'exact';
    const input = String(channelName);
    // Try input first, then both v-prefixed and non-v variants.
    const candidates = [input];
    if (input.startsWith('v')) {
      candidates.push(input.slice(1));
    } else {
      candidates.push(`v${input}`);
    }
    let found = null;
    let lastErr = null;
    for (const tag of candidates) {
      try {
        const r = await tryResolveTag(repo, tag, fetchFn);
        if (r) {
          found = r;
          break;
        }
      } catch (err) {
        lastErr = err;
      }
    }
    if (!found) {
      throw new Error(
        `github provider: release tag '${input}' not found in ${repo}` +
          (lastErr ? ` (${lastErr.message})` : ''),
      );
    }
    release = found;
    // Synthesize a channel entry for asset lookup using stable's pattern as default.
    const stableEntry = channelsConfig && channelsConfig.stable;
    channelEntry = stableEntry || { assetPattern: 'lightpanda-{arch}-{os}' };
  } else {
    resolverKind = channelEntry.resolver;
    if (resolverKind === 'tag') {
      release = await resolveTag(repo, channelEntry.tag, fetchFn);
    } else if (resolverKind === 'newest-non-prerelease') {
      release = await resolveNewestNonPrerelease(repo, fetchFn);
    } else {
      throw new Error(
        `github provider: unknown resolver "${resolverKind}" for channel "${resolvedName}"`,
      );
    }
  }

  const binaryAsset = findBinaryAsset(release, channelEntry, platform, arch);
  const sha256 = await findChecksum(release, binaryAsset, fetchFn);

  // Compute version.
  let version;
  if (resolverKind === 'tag') {
    version = `${channelEntry.tag}-${isoToDateStamp(release.published_at)}`;
  } else {
    version = stripV(release.tag_name);
  }

  return {
    version,
    assetUrl: binaryAsset.browser_download_url,
    sha256: sha256 || null,
    requireChecksum: !!channelEntry.requireChecksum,
    tag: release.tag_name,
    publishedAt: release.published_at,
  };
}
