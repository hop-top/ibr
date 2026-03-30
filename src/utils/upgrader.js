import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const UPDATE_CACHE = new Map();
let externalUpgradeModulePromise;

export function resetUpgradeTestState() {
  UPDATE_CACHE.clear();
}

function normalizeVersion(version) {
  if (typeof version !== 'string' || version.trim() === '') {
    return null;
  }

  const normalized = version.trim().replace(/^v/i, '');
  const [core, preRelease = ''] = normalized.split('-', 2);
  const parts = core.split('.').map((part) => Number.parseInt(part, 10));

  if (parts.some((part) => Number.isNaN(part))) {
    return null;
  }

  return { parts, preRelease };
}

function comparePreRelease(a, b) {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;

  const aParts = a.split('.');
  const bParts = b.split('.');
  const maxLength = Math.max(aParts.length, bParts.length);

  for (let i = 0; i < maxLength; i++) {
    const left = aParts[i];
    const right = bParts[i];

    if (left === undefined) return -1;
    if (right === undefined) return 1;

    const leftNum = Number.parseInt(left, 10);
    const rightNum = Number.parseInt(right, 10);
    const leftIsNum = !Number.isNaN(leftNum) && String(leftNum) === left;
    const rightIsNum = !Number.isNaN(rightNum) && String(rightNum) === right;

    if (leftIsNum && rightIsNum && leftNum !== rightNum) {
      return leftNum > rightNum ? 1 : -1;
    }

    if (leftIsNum !== rightIsNum) {
      return leftIsNum ? -1 : 1;
    }

    if (left !== right) {
      return left > right ? 1 : -1;
    }
  }

  return 0;
}

export function isNewer(currentVersion, nextVersion) {
  const current = normalizeVersion(currentVersion);
  const next = normalizeVersion(nextVersion);

  if (!current || !next) {
    return false;
  }

  const maxLength = Math.max(current.parts.length, next.parts.length);
  for (let i = 0; i < maxLength; i++) {
    const left = current.parts[i] || 0;
    const right = next.parts[i] || 0;

    if (left !== right) {
      return right > left;
    }
  }

  return comparePreRelease(current.preRelease, next.preRelease) < 0;
}

function getCacheKey(binary, releaseUrl) {
  return `${binary}:${releaseUrl}`;
}

export async function checkForUpdate(binary, currentVersion, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const releaseUrl = options.releaseUrl;
  const cacheTtlMs = options.cacheTtlMs ?? 5 * 60 * 1000;

  if (!releaseUrl) {
    throw new Error('checkForUpdate requires a releaseUrl option');
  }

  const cacheKey = getCacheKey(binary, releaseUrl);
  const cached = UPDATE_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < cacheTtlMs) {
    return cached.value;
  }

  const response = await fetchImpl(releaseUrl, {
    headers: {
      'accept': 'application/json',
      'user-agent': `${binary}/${currentVersion || 'dev'}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch release info from ${releaseUrl}: HTTP ${response.status}`);
  }

  const payload = await response.json();
  const result = {
    updateAvail: isNewer(currentVersion, payload.version),
    latest: payload.version || null,
    url: payload.url || null,
    notes: payload.notes || '',
  };

  UPDATE_CACHE.set(cacheKey, { timestamp: Date.now(), value: result });
  return result;
}

function getStateFile(binary) {
  const stateRoot = process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state');
  return path.join(stateRoot, binary, 'upgrade-state.json');
}

function readState(binary) {
  const stateFile = getStateFile(binary);
  try {
    return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  } catch {
    return {};
  }
}

function writeState(binary, state) {
  const stateFile = getStateFile(binary);
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
}

async function loadExternalUpgradeModule() {
  if (!externalUpgradeModulePromise) {
    externalUpgradeModulePromise = import('@hop/upgrade').catch(() => null);
  }

  return externalUpgradeModulePromise;
}

function getDefaultReleaseUrl(githubRepo) {
  return `https://raw.githubusercontent.com/${githubRepo}/main/upgrade.json`;
}

export function createUpgrader({ binary, githubRepo }) {
  const releaseUrl = getDefaultReleaseUrl(githubRepo);

  function isSnoozed() {
    const state = readState(binary);
    return Number(state.snoozedUntil || 0) > Date.now();
  }

  function snooze(ms) {
    const state = readState(binary);
    state.snoozedUntil = Date.now() + ms;
    writeState(binary, state);
  }

  async function notifyIfAvailable(currentVersion) {
    if (isSnoozed()) {
      return;
    }

    const external = await loadExternalUpgradeModule();
    if (external?.createUpgrader) {
      const nativeUpgrader = external.createUpgrader({ binary, githubRepo });
      return nativeUpgrader.notifyIfAvailable(currentVersion);
    }

    try {
      const update = await checkForUpdate(binary, currentVersion, { releaseUrl });
      if (update.updateAvail) {
        process.stderr.write(
          `${binary}: update available ${currentVersion} -> ${update.latest}. Run "${binary} upgrade" for details.\n`
        );
      }
    } catch {
      // Startup notification should never block CLI execution.
    }
  }

  function generatePreamble(level = 'once') {
    const qualifier = level === 'always'
      ? 'before every run'
      : level === 'never'
        ? 'manually when you want to update'
        : 'occasionally';

    return [
      `Keep ${binary} current ${qualifier}.`,
      `Run \`${binary} upgrade\` to check for a newer release.`,
      `Run \`${binary} upgrade --auto\` to install automatically when supported.`,
      '',
    ].join('\n');
  }

  async function runUpgradeCLI(currentVersion, options = {}) {
    const external = await loadExternalUpgradeModule();
    if (external?.createUpgrader) {
      const nativeUpgrader = external.createUpgrader({ binary, githubRepo });
      return nativeUpgrader.runUpgradeCLI(currentVersion, options);
    }

    const update = await checkForUpdate(binary, currentVersion, { releaseUrl });
    if (!update.updateAvail) {
      if (!options.quiet) {
        process.stdout.write(`${binary} is up to date (v${currentVersion}).\n`);
      }
      return;
    }

    process.stdout.write(`Update available for ${binary}: v${currentVersion} -> v${update.latest}\n`);
    if (update.notes) {
      process.stdout.write(`${update.notes}\n`);
    }
    if (update.url) {
      process.stdout.write(`${update.url}\n`);
    }
    if (options.auto) {
      process.stderr.write(
        `Automatic upgrade is unavailable in this checkout because @hop/upgrade is not installed.\n`
      );
    }
  }

  return {
    isSnoozed,
    snooze,
    notifyIfAvailable,
    generatePreamble,
    runUpgradeCLI,
  };
}
