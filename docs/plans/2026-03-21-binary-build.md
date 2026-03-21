# Binary Build (esbuild + Node SEA) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this
> plan task-by-task.

**Goal:** Bundle `ibr` CLI into a self-contained native binary using esbuild + Node.js SEA.

**Architecture:** esbuild bundles all JS (incl. deps) into a single CJS blob; Node SEA
injects that blob into a copy of the Node binary; postject stitches them; result is a
standalone `ibr` executable. Two binaries: `ibr` (CLI) and `ibr-server` (daemon).

**Tech Stack:** esbuild (bundler), Node.js >=20 SEA API, postject (injector), just
(task runner).

---

### Task 1: Install build deps

**Files:**
- Modify: `package.json`

**Step 1: Add esbuild + postject as devDependencies**

    cd /Users/jadb/.w/ideacrafterslabs/ibr/hops/main
    PATH=/opt/homebrew/bin:$HOME/.local/bin:$PATH pnpm add -D esbuild postject

Expected: node_modules/.bin/esbuild exists.

**Step 2: Verify**

    ./node_modules/.bin/esbuild --version

Expected: version string like 0.25.x.

**Step 3: Commit**

    git add package.json pnpm-lock.yaml
    git commit -m "build: add esbuild + postject devDeps for SEA binary"

---

### Task 2: esbuild bundle script

**Files:**
- Create: `scripts/build.mjs`

**Context:** esbuild must output CJS (SEA requires CJS). Playwright and better-sqlite3
ship native binaries — they must be external (not bundled). Use `packages: 'external'`
to skip all node_modules; native deps load from node_modules at runtime.

**Step 1: Create `scripts/build.mjs`**

    import { build } from 'esbuild';
    import { mkdirSync } from 'fs';

    mkdirSync('dist', { recursive: true });

    const shared = {
      bundle: true,
      platform: 'node',
      format: 'cjs',
      packages: 'external',   // don't embed any node_modules
      minify: false,
      sourcemap: false,
    };

    await build({ ...shared, entryPoints: ['src/index.js'],  outfile: 'dist/ibr.cjs' });
    await build({ ...shared, entryPoints: ['src/server.js'], outfile: 'dist/ibr-server.cjs' });

    console.log('esbuild done -> dist/ibr.cjs, dist/ibr-server.cjs');

**Step 2: Smoke-test bundle**

    node scripts/build.mjs
    ls -lh dist/

Expected: dist/ibr.cjs and dist/ibr-server.cjs, no errors.

**Step 3: Runtime smoke-test (no browser)**

    node dist/ibr.cjs --help 2>&1 | head -5

Expected: help/usage text, not a crash about missing module.

**Step 4: Commit**

    git add scripts/build.mjs dist/
    git commit -m "build: esbuild bundle script -> dist/ibr.cjs + dist/ibr-server.cjs"

---

### Task 3: SEA injection script

**Files:**
- Create: `scripts/sea.mjs`

**Context:** Node SEA workflow (Node >=20):
1. Write sea-config.json
2. node --experimental-sea-config sea-config.json  =>  sea-prep.blob
3. Copy node binary; strip codesig (macOS); postject inject blob; re-sign (macOS)

**Step 1: Create `scripts/sea.mjs`**

    import { execSync } from 'child_process';
    import { writeFileSync, copyFileSync, mkdirSync } from 'fs';

    const platform = process.platform;
    mkdirSync('dist', { recursive: true });

    function makeSeaBinary({ name, cjsEntry }) {
      const blobPath = `dist/${name}.blob`;
      const outBin   = platform === 'win32' ? `dist/${name}.exe` : `dist/${name}`;
      const nodeBin  = process.execPath;

      const cfg = { main: cjsEntry, output: blobPath,
                    disableExperimentalSEAWarning: true };
      writeFileSync('sea-config.json', JSON.stringify(cfg, null, 2));

      console.log(`[${name}] generating SEA blob...`);
      execSync('node --experimental-sea-config sea-config.json', { stdio: 'inherit' });

      copyFileSync(nodeBin, outBin);

      if (platform === 'darwin') {
        execSync(`codesign --remove-signature "${outBin}"`, { stdio: 'inherit' });
      }

      console.log(`[${name}] injecting blob...`);
      const macFlag = platform === 'darwin' ? '--macho-segment-name NODE_SEA' : '';
      execSync(
        `node node_modules/.bin/postject "${outBin}" NODE_SEA_BLOB "${blobPath}" \
          --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 ${macFlag}`,
        { stdio: 'inherit' }
      );

      if (platform === 'darwin') {
        execSync(`codesign --sign - "${outBin}"`, { stdio: 'inherit' });
      }

      console.log(`[${name}] done: ${outBin}`);
    }

    makeSeaBinary({ name: 'ibr',        cjsEntry: 'dist/ibr.cjs' });
    makeSeaBinary({ name: 'ibr-server', cjsEntry: 'dist/ibr-server.cjs' });

**Step 2: Run SEA build**

    node scripts/sea.mjs

Expected: dist/ibr and dist/ibr-server created, no errors.

**Step 3: Smoke-test binary**

    ./dist/ibr --help 2>&1 | head -5
    file dist/ibr

Expected: Mach-O 64-bit executable (macOS) or ELF 64-bit (Linux).

**Step 4: Commit**

    git add scripts/sea.mjs sea-config.json
    git commit -m "build: SEA injection script -> dist/ibr + dist/ibr-server binaries"

---

### Task 4: justfile targets + package.json scripts

**Files:**
- Modify: `justfile`
- Modify: `package.json`

**Step 1: Add to `justfile`**

    build:
        node scripts/build.mjs && node scripts/sea.mjs

    build-bundle:
        node scripts/build.mjs

    build-sea:
        node scripts/sea.mjs

**Step 2: Add to `package.json` scripts section**

    "build":        "node scripts/build.mjs && node scripts/sea.mjs",
    "build:bundle": "node scripts/build.mjs",
    "build:sea":    "node scripts/sea.mjs"

**Step 3: Test via just**

    just build

Expected: full build completes, dist/ibr exists.

**Step 4: Commit**

    git add justfile package.json
    git commit -m "build: add just build targets for bundle + SEA"

---

### Task 5: .gitignore + dist/ policy

**Files:**
- Modify: `.gitignore` (create if missing)

**Step 1: Ensure dist/ and sea-config.json are ignored**

    grep -q '^dist/' .gitignore 2>/dev/null || echo 'dist/' >> .gitignore
    grep -q 'sea-config' .gitignore 2>/dev/null || echo 'sea-config.json' >> .gitignore

**Step 2: Unstage dist/ if accidentally staged**

    git rm -r --cached dist/ 2>/dev/null || true

**Step 3: Commit**

    git add .gitignore
    git commit -m "chore: ignore dist/ and sea-config.json build artifacts"

---

### Task 6: README build section

**Files:**
- Modify: `README.md` (create if missing)

**Step 1: Add a ## Building section**

Content to add:

    ## Building

    Requires Node >=20. Run once to produce dist/ibr and dist/ibr-server:

        just build

    Binaries are self-contained (no Node runtime needed). Native deps (Playwright,
    better-sqlite3, @boundaryml/baml) must still exist in node_modules alongside
    the binary; they cannot be embedded in the SEA blob.

**Step 2: Commit**

    git add README.md
    git commit -m "docs: add build section for SEA binary"

---

## Known Limitations

- Native deps can't be embedded — Playwright, better-sqlite3, @boundaryml/baml must
  exist in node_modules next to the binary (not portable without them).
- packages: 'external' means all node_modules are runtime deps, not bundled.
  Remove this if you want a fully-bundled CJS (handle native exclusions manually).
- SEA binary embeds the exact Node version/arch used to build. Not cross-compilable.
