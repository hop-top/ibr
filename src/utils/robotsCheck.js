/**
 * robots.txt compliance checker — pure, no side-effects.
 *
 * Spec:
 *   - Fetches <origin>/robots.txt via plain HTTP GET (fetch / node:https).
 *   - Parses User-agent: * and User-agent: ibr blocks.
 *   - Checks Disallow / Allow directives for the target path.
 *   - ibr-specific block takes precedence over wildcard block.
 *   - On fetch failure (404, timeout, network error) → warn + allow.
 *   - Allow directive for a more-specific path overrides a shorter Disallow.
 *
 * @module robotsCheck
 */

import logger from './logger.js';

/**
 * Parse robots.txt content into a map of user-agent → [{type, path}].
 *
 * @param {string} text  - raw robots.txt content
 * @returns {Map<string, Array<{type: 'Allow'|'Disallow', path: string}>>}
 */
export function parseRobotsTxt(text) {
  /** @type {Map<string, Array<{type: string, path: string}>>} */
  const blocks = new Map();
  let currentAgents = [];
  // Track whether the current group has seen at least one directive line.
  // A blank line or new User-agent after directives signals a new group.
  let groupHasDirectives = false;

  for (const rawLine of text.split('\n')) {
    const line = rawLine.split('#')[0].trim(); // strip inline comments

    if (!line) {
      // Blank line ends the current group
      if (groupHasDirectives) {
        currentAgents = [];
        groupHasDirectives = false;
      }
      continue;
    }

    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;

    const field = line.slice(0, colonIdx).trim().toLowerCase();
    const value = line.slice(colonIdx + 1).trim();

    if (field === 'user-agent') {
      // Starting a new User-agent line after directives → new group
      if (groupHasDirectives) {
        currentAgents = [];
        groupHasDirectives = false;
      }
      const agent = value.toLowerCase();
      currentAgents = currentAgents.concat(agent);
      if (!blocks.has(agent)) {
        blocks.set(agent, []);
      }
    } else if (field === 'allow' || field === 'disallow') {
      const type = field === 'allow' ? 'Allow' : 'Disallow';
      for (const agent of currentAgents) {
        if (!blocks.has(agent)) blocks.set(agent, []);
        blocks.get(agent).push({ type, path: value });
      }
      groupHasDirectives = true;
    } else {
      // Unknown directive — reset group
      currentAgents = [];
      groupHasDirectives = false;
    }
  }

  return blocks;
}

/**
 * Check whether a given path is allowed under a single block of directives.
 * Applies longest-match wins: more-specific path beats shorter one.
 * A tie between Allow and Disallow on the same specificity → Allow wins.
 *
 * @param {string} urlPath  - path portion of the target URL (e.g. "/products/item")
 * @param {Array<{type: string, path: string}>} directives
 * @returns {boolean} true if allowed
 */
export function isAllowedByDirectives(urlPath, directives) {
  let bestMatch = null; // {type, length}

  for (const { type, path: rulePath } of directives) {
    if (!rulePath) {
      // Empty Disallow means "allow all"; empty Allow is a no-op
      if (type === 'Disallow') return true;
      continue;
    }

    if (urlPath.startsWith(rulePath)) {
      const len = rulePath.length;
      if (
        bestMatch === null ||
        len > bestMatch.length ||
        // Same length: Allow wins over Disallow (per RFC 9309 §2.2.2)
        (len === bestMatch.length && type === 'Allow')
      ) {
        bestMatch = { type, length: len };
      }
    }
  }

  if (!bestMatch) return true; // no matching rule → allowed
  return bestMatch.type === 'Allow';
}

/**
 * Fetch and check robots.txt for the given URL.
 *
 * @param {string} url  - full target URL (e.g. "https://example.com/products/item")
 * @returns {Promise<{ allowed: boolean, reason?: string }>}
 */
export async function checkRobots(url) {
  let origin;
  let pathname;

  try {
    const parsed = new URL(url);
    origin = parsed.origin;
    pathname = parsed.pathname || '/';
  } catch {
    logger.warn('checkRobots: invalid URL, skipping robots check', { url });
    return { allowed: true, reason: 'invalid-url' };
  }

  const robotsUrl = `${origin}/robots.txt`;
  let text;

  try {
    const res = await fetch(robotsUrl, {
      signal: AbortSignal.timeout(5000),
      headers: { 'User-Agent': 'ibr' },
    });

    if (res.status === 404) {
      logger.warn('checkRobots: robots.txt not found (404), continuing', { robotsUrl });
      return { allowed: true, reason: 'not-found' };
    }

    if (!res.ok) {
      logger.warn(`checkRobots: robots.txt fetch returned ${res.status}, continuing`, { robotsUrl });
      return { allowed: true, reason: `http-${res.status}` };
    }

    text = await res.text();
  } catch (err) {
    logger.warn(`checkRobots: failed to fetch robots.txt (${err.message}), continuing`, { robotsUrl });
    return { allowed: true, reason: 'fetch-error' };
  }

  const blocks = parseRobotsTxt(text);

  // ibr-specific block takes precedence over wildcard
  const ibrDirectives = blocks.get('ibr');
  const wildcardDirectives = blocks.get('*');

  let allowed;
  if (ibrDirectives && ibrDirectives.length > 0) {
    allowed = isAllowedByDirectives(pathname, ibrDirectives);
    logger.debug('checkRobots: checked User-agent: ibr block', { pathname, allowed });
  } else if (wildcardDirectives && wildcardDirectives.length > 0) {
    allowed = isAllowedByDirectives(pathname, wildcardDirectives);
    logger.debug('checkRobots: checked User-agent: * block', { pathname, allowed });
  } else {
    allowed = true;
    logger.debug('checkRobots: no applicable block found, allowing', { pathname });
  }

  return allowed
    ? { allowed: true }
    : { allowed: false, reason: 'disallowed-by-robots' };
}
