import { build } from 'esbuild';
import { mkdirSync, readFileSync } from 'fs';

mkdirSync('dist', { recursive: true });

// Shared esbuild config. packages: 'external' keeps all node_modules out of
// the bundle — external require() calls are resolved at runtime by Node.
const shared = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  minify: false,
  sourcemap: false,
};

// Regular bundles — used for `node dist/ibr.cjs` invocation.
await build({ ...shared, entryPoints: ['src/index.js'],  outfile: 'dist/ibr.cjs' });
await build({ ...shared, entryPoints: ['src/server.js'], outfile: 'dist/ibr-server.cjs' });
console.log('esbuild done -> dist/ibr.cjs, dist/ibr-server.cjs');

// ---------------------------------------------------------------------------
// SEA bundles — self-contained for Node Single Executable Application.
//
// Problem: Node SEA's embedderRequire() only resolves built-in modules; it
// does NOT search node_modules. All external packages must either be:
//   (a) bundled into the blob, OR
//   (b) loaded via createRequire(process.execPath), which uses normal CJS
//       resolution and finds node_modules co-located with the binary.
//
// Strategy:
//   1. Bundle all deps (no packages: 'external').
//   2. Keep a minimal set of externals that can't be bundled:
//      - better-sqlite3  — native .node addon
//      - bufferutil      — optional ws native addon (graceful-degradation ok)
//      - utf-8-validate  — optional ws native addon (graceful-degradation ok)
//      - chromium-bidi   — phantom pnpm dep (playwright falls back without it)
//      - electron        — Electron-specific; not used for Chromium headless
//   3. Patch playwright's require.resolve() calls that are unavailable in SEA.
//   4. Prepend a banner that sets up _seaRequire = createRequire(execPath),
//      then post-process the output to replace remaining external require()
//      calls with _seaRequire() — so they use filesystem resolution.
//
// Deployment: ship dist/ibr alongside dist/node_modules -> ../node_modules
// (symlink created by sea.mjs). createRequire(execPath) then finds packages.
// ---------------------------------------------------------------------------

// Packages that truly cannot be bundled (native addons / phantom deps / unused).
// These are replaced in the output with _seaRequire() calls, which resolve
// against node_modules co-located with the binary at runtime.
const seaExternalPackages = new Set([
  'better-sqlite3',   // native .node addon
  'bufferutil',       // optional ws native perf addon — ws degrades gracefully
  'utf-8-validate',   // optional ws native addon
  'chromium-bidi',    // phantom pnpm dep (playwright bidi protocol, not used by default)
  'electron',         // Electron runtime — not used for headless Chromium
]);

/** Patches require.resolve() calls that crash inside SEA embedderRequire. */
const seaPatchPlugin = {
  name: 'sea-patch',
  setup(build) {
    // nodePlatform.js: coreDir used only for stack-trace filtering.
    build.onLoad(
      { filter: /playwright-core\/lib\/server\/utils\/nodePlatform\.js$/ },
      ({ path }) => {
        let contents = readFileSync(path, 'utf8');
        contents = contents.replace(
          /require\.resolve\(["']\.\.\/\.\.\/\.\.\/package\.json["']\)/g,
          '(typeof __dirname !== "undefined" ? __dirname + "/../../../package.json" : "")'
        );
        return { contents, loader: 'js' };
      }
    );
    // launchApp.js: reads appIcon.png for Electron app window — not used headless.
    build.onLoad(
      { filter: /playwright-core\/lib\/server\/launchApp\.js$/ },
      ({ path }) => {
        let contents = readFileSync(path, 'utf8');
        contents = contents.replace(
          /require\.resolve\(["']\.\/chromium\/appIcon\.png["']\)/g,
          '(typeof __dirname !== "undefined" ? __dirname + "/chromium/appIcon.png" : "")'
        );
        return { contents, loader: 'js' };
      }
    );
    // electron.js: require.resolve("./loader") — Electron-specific, not used.
    build.onLoad(
      { filter: /playwright-core\/lib\/server\/electron\/electron\.js$/ },
      ({ path }) => {
        let contents = readFileSync(path, 'utf8');
        contents = contents.replace(
          /require\.resolve\(["']\.\/loader["']\)/g,
          '(typeof __dirname !== "undefined" ? __dirname + "/loader.js" : "")'
        );
        return { contents, loader: 'js' };
      }
    );
  },
};

// Banner: defines _seaRequire using createRequire(process.execPath).
// In SEA, process.execPath is the binary path; CJS resolution walks up from
// its directory to find node_modules, making external packages loadable.
const seaBanner = `
var _seaRequire;
(function() {
  var _m = require('module');
  _seaRequire = _m.createRequire ? _m.createRequire(process.execPath) : require;
})();
`.trim();

const seaShared = {
  ...shared,
  packages: undefined,          // bundle all deps (override 'external')
  external: [...seaExternalPackages],
  plugins: [seaPatchPlugin],
  banner: { js: seaBanner },
};

async function buildSea(entryPoint, outfile) {
  // First pass: build with esbuild.
  await build({ ...seaShared, entryPoints: [entryPoint], outfile });

  // Second pass: post-process to replace external require() with _seaRequire().
  // esbuild marks externals as require("pkg") in the output; we rewrite those
  // specific calls so the SEA runtime uses the createRequire-based loader.
  let content = readFileSync(outfile, 'utf8');
  let count = 0;
  for (const pkg of seaExternalPackages) {
    // Match require("pkg") and require('pkg') exactly — not subpath matches.
    // Escape special regex chars in package name (e.g. '@' in scoped packages).
    const escaped = pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`require\\(([\"'])${escaped}\\1\\)`, 'g');
    const before = content.length;
    content = content.replace(re, `_seaRequire($1${pkg}$1)`);
    if (content.length !== before || content.includes(`_seaRequire("${pkg}")`)) count++;
  }
  // Also replace subpath requires for external packages (e.g. chromium-bidi/lib/...).
  // These appear as require("chromium-bidi/lib/...").
  for (const pkg of seaExternalPackages) {
    const escaped = pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`require\\(([\"'])${escaped}/([^\"']*)\\1\\)`, 'g');
    content = content.replace(re, `_seaRequire($1${pkg}/$2$1)`);
  }
  const { writeFileSync } = await import('fs');
  writeFileSync(outfile, content, 'utf8');
  console.log(`[sea-patch] rewrote external requires -> _seaRequire() in ${outfile}`);
}

await buildSea('src/index.js',  'dist/ibr-sea.cjs');
await buildSea('src/server.js', 'dist/ibr-server-sea.cjs');
console.log('esbuild done -> dist/ibr-sea.cjs, dist/ibr-server-sea.cjs');
