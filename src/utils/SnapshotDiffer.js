/**
 * SnapshotDiffer — mode-aware diffing for state-change awareness.
 *
 * dom mode : XPath-indexed DOM diffing (DomSimplifier trees)
 * aria mode: text-based line diffing (ariaSnapshot strings)
 *
 * Reduces AI token usage by sending only what changed between snapshots.
 */

const MAX_HISTORY = 5;
const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
const LARGE_CHANGE_RATIO = 0.5;

// ─── DOM mode helpers ────────────────────────────────────────────────────────

/**
 * Flatten a simplified DOM tree into a map keyed by XPath index (x).
 * @param {Object} node
 * @param {Map} map
 */
function flattenByIndex(node, map = new Map()) {
  if (!node || typeof node !== 'object') return map;
  if (node.x !== undefined) {
    map.set(node.x, node);
  }
  if (Array.isArray(node.c)) {
    for (const child of node.c) {
      flattenByIndex(child, map);
    }
  }
  return map;
}

/**
 * Build a map of xpath-string → node using a separate xpaths array.
 * @param {Object} domTree
 * @param {string[]} xpaths
 * @returns {Map<string, Object>}
 */
function buildPathMap(domTree, xpaths) {
  const flat = flattenByIndex(domTree);
  const pathMap = new Map();
  for (const [flatIndex, node] of flat) {
    const path = (xpaths && xpaths[flatIndex]) ? xpaths[flatIndex] : String(flatIndex);
    pathMap.set(path, node);
  }
  return pathMap;
}

/**
 * Extract the ARIA/semantic attributes that matter for diffing.
 * @param {Object} node
 * @returns {Object}
 */
function semanticAttrs(node) {
  const a = node.a || {};
  return {
    'aria-label': a['aria-label'],
    'aria-disabled': a['aria-disabled'],
    'aria-expanded': a['aria-expanded'],
    'aria-selected': a['aria-selected'],
    'aria-checked': a['aria-checked'],
    'aria-hidden': a['aria-hidden'],
    title: a.title,
    href: a.href,
    src: a.src,
    alt: a.alt,
    id: a.id,
    name: a.name,
    content: a.content,
  };
}

/**
 * Compare two attr objects; return changed pairs or null.
 * @param {Object} prev
 * @param {Object} curr
 * @returns {Object|null}
 */
function diffAttrs(prev, curr) {
  const changed = {};
  const keys = new Set([...Object.keys(prev), ...Object.keys(curr)]);
  for (const k of keys) {
    if (prev[k] !== curr[k]) {
      changed[k] = [prev[k], curr[k]];
    }
  }
  return Object.keys(changed).length ? changed : null;
}

// ─── ARIA mode helpers ───────────────────────────────────────────────────────

/**
 * Extract a stable key from an ariaSnapshot line (role + name when present).
 * Lines look like: "- role 'name': text" or "- role:" or indented variants.
 * Returns the raw line as fallback — good enough for exact-match detection.
 * @param {string} line
 * @returns {string}
 */
function ariaLineKey(line) {
  // Match patterns: "- button 'Submit'" or "- heading 'Title' [level=2]"
  const m = line.match(/^\s*-\s+(\w[\w-]*)\s+'([^']+)'/);
  if (m) return `${m[1]}:'${m[2]}'`;
  // Match "- role:" without a name
  const r = line.match(/^\s*-\s+(\w[\w-]*):/);
  if (r) return r[1];
  return line;
}

/**
 * Diff two ariaSnapshot strings (line-based set diff).
 * @param {string} prevSnap
 * @param {string} currSnap
 * @returns {{added: string[], removed: string[], modified: Array<{prev: string, curr: string}>, largeChange: boolean, summary: string}}
 */
function diffAriaSnapshots(prevSnap, currSnap) {
  const prevLines = prevSnap.split('\n').filter(l => l.trim());
  const currLines = currSnap.split('\n').filter(l => l.trim());

  const prevSet = new Set(prevLines);
  const currSet = new Set(currLines);

  // Build key → line maps for modified detection
  const prevKeys = new Map(prevLines.map(l => [ariaLineKey(l), l]));
  const currKeys = new Map(currLines.map(l => [ariaLineKey(l), l]));

  const added = [];
  const removed = [];
  const modified = [];

  for (const [key, currLine] of currKeys) {
    if (!prevKeys.has(key)) {
      if (!prevSet.has(currLine)) added.push(currLine);
    } else {
      const prevLine = prevKeys.get(key);
      if (prevLine !== currLine) {
        modified.push({ prev: prevLine, curr: currLine });
      }
    }
  }

  for (const [key, prevLine] of prevKeys) {
    if (!currKeys.has(key) && !currSet.has(prevLine)) {
      removed.push(prevLine);
    }
  }

  const totalLines = prevLines.length || 1;
  const largeChange = (added.length + removed.length) / totalLines > LARGE_CHANGE_RATIO;
  const summary = `Added ${added.length}, removed ${removed.length}, modified ${modified.length}`;

  return { added, removed, modified, largeChange, summary };
}

// ─── SnapshotDiffer ──────────────────────────────────────────────────────────

export class SnapshotDiffer {
  constructor() {
    /**
     * @type {Array<{
     *   mode: 'dom'|'aria',
     *   tree?: Object,
     *   xpaths?: string[],
     *   snapshot?: string,
     *   ts: number
     * }>}
     */
    this.history = [];
  }

  /**
   * Store a snapshot for later diffing.
   *
   * dom mode  — pass (domTree, xpaths, 'dom')
   * aria mode — pass (ariaSnapshotString, null, 'aria')
   *
   * @param {Object|string} snapshot  - dom: tree object; aria: snapshot string
   * @param {string[]|null} xpaths    - dom: xpaths array; aria: null/omit
   * @param {'dom'|'aria'} [mode='dom']
   */
  captureSnapshot(snapshot, xpaths, mode = 'dom') {
    const entry = { mode, ts: Date.now() };
    if (mode === 'aria') {
      entry.snapshot = typeof snapshot === 'string' ? snapshot : String(snapshot);
    } else {
      entry.tree = snapshot;
      entry.xpaths = xpaths || [];
    }
    this.history.push(entry);
    if (this.history.length > MAX_HISTORY) {
      this.history.shift();
    }
  }

  /**
   * Whether we have a valid recent snapshot to diff against.
   * @returns {boolean}
   */
  shouldUseDiff() {
    if (this.history.length < 1) return false;
    const last = this.history[this.history.length - 1];
    return (Date.now() - last.ts) < STALE_THRESHOLD_MS;
  }

  /**
   * Compute diff between the most-recent stored snapshot and the current snapshot.
   *
   * dom mode  — computeDiff(currTree, currXpaths)
   * aria mode — computeDiff(currAriaString, null)
   *
   * If modes mismatch, returns largeChange=true to force a full snapshot.
   *
   * @param {Object|string} curr       - current dom tree or aria string
   * @param {string[]|null} [currXpaths]
   * @returns {{added, removed, modified, largeChange: boolean, summary: string}}
   */
  computeDiff(curr, currXpaths) {
    if (this.history.length === 0) {
      return {
        added: [],
        removed: [],
        modified: [],
        largeChange: true,
        summary: 'No baseline snapshot',
      };
    }

    const prev = this.history[this.history.length - 1];

    // Detect current mode from the type of `curr` and stored mode
    const currMode = prev.mode; // caller must match; mismatch = largeChange

    // Mode mismatch guard
    if (
      (prev.mode === 'aria' && typeof curr !== 'string') ||
      (prev.mode === 'dom' && typeof curr === 'string')
    ) {
      return {
        added: [],
        removed: [],
        modified: [],
        largeChange: true,
        summary: 'Mode mismatch — forcing full snapshot',
      };
    }

    if (currMode === 'aria') {
      return diffAriaSnapshots(prev.snapshot, curr);
    }

    // dom mode
    const prevMap = buildPathMap(prev.tree, prev.xpaths);
    const currMap = buildPathMap(curr, currXpaths || []);

    const added = [];
    const removed = [];
    const modified = [];

    for (const [path, currNode] of currMap) {
      const prevNode = prevMap.get(path);
      if (!prevNode) {
        added.push({
          x: currNode.x,
          n: currNode.n,
          a: currNode.a || {},
          t: currNode.t || undefined,
          path,
        });
      } else {
        const changes = {};
        if ((prevNode.t || '') !== (currNode.t || '')) {
          changes.t = [prevNode.t || '', currNode.t || ''];
        }
        const attrDiff = diffAttrs(semanticAttrs(prevNode), semanticAttrs(currNode));
        if (attrDiff) {
          changes.a = attrDiff;
        }
        if (Object.keys(changes).length > 0) {
          modified.push({ x: currNode.x, path, changes });
        }
      }
    }

    for (const [path, prevNode] of prevMap) {
      if (!currMap.has(path)) {
        removed.push({ x: prevNode.x, path });
      }
    }

    const totalNodes = prevMap.size || 1;
    const changeRatio = (added.length + removed.length) / totalNodes;
    const largeChange = changeRatio > LARGE_CHANGE_RATIO;
    const summary = `Added ${added.length}, removed ${removed.length}, modified ${modified.length}`;

    return { added, removed, modified, largeChange, summary };
  }

  /**
   * Clear snapshot history (call on navigation or timeout).
   */
  reset() {
    this.history = [];
  }
}

export default SnapshotDiffer;
