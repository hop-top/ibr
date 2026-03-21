import { execSync } from 'child_process';
import { writeFileSync, copyFileSync, mkdirSync, chmodSync, existsSync, symlinkSync, rmSync } from 'fs';

const platform = process.platform;
const arch = process.arch;
mkdirSync('dist', { recursive: true });

/**
 * Homebrew splits Node into stub + libnode.dylib; the stub lacks the SEA fuse.
 * Detect split build by checking for @rpath in linked libs (otool -L).
 * If split, download the official self-contained binary and cache it.
 */
function getSeaNodeBin() {
  const current = process.execPath;
  if (platform !== 'darwin') return current;
  const otool = execSync(`otool -L "${current}" 2>&1 || true`, { encoding: 'utf8' });
  if (!otool.includes('@rpath')) return current;

  const version = process.version; // e.g. v25.8.1
  const cachePath = `dist/.node-sea-bin`;
  if (existsSync(cachePath)) {
    console.log(`[sea] using cached self-contained node at ${cachePath}`);
    return cachePath;
  }

  const plat = platform === 'darwin' ? 'darwin' : platform === 'win32' ? 'win' : 'linux';
  const archStr = arch === 'arm64' ? 'arm64' : 'x64';
  const tarName = `node-${version}-${plat}-${archStr}.tar.gz`;
  const url = `https://nodejs.org/dist/${version}/${tarName}`;
  const tarPath = `dist/.node-sea.tar.gz`;

  console.log(`[sea] homebrew node is split-build; downloading self-contained ${version}...`);
  execSync(`curl -fsSL "${url}" -o "${tarPath}"`, { stdio: 'inherit' });
  execSync(`tar -xzf "${tarPath}" -C dist/ --strip-components=2 node-${version}-${plat}-${archStr}/bin/node`, { stdio: 'inherit' });
  execSync(`mv dist/node "${cachePath}"`, { stdio: 'inherit' });
  execSync(`rm -f "${tarPath}"`, { stdio: 'inherit' });
  chmodSync(cachePath, 0o755);
  console.log(`[sea] cached at ${cachePath}`);
  return cachePath;
}

function makeSeaBinary({ name, entry, nodeBin }) {
  const blobPath = `dist/${name}.blob`;
  const outBin   = platform === 'win32' ? `dist/${name}.exe` : `dist/${name}`;

  writeFileSync('sea-config.json', JSON.stringify({
    main: entry,
    output: blobPath,
    disableExperimentalSEAWarning: true,
  }, null, 2));

  console.log(`[${name}] generating SEA blob...`);
  execSync(`"${nodeBin}" --experimental-sea-config sea-config.json`, { stdio: 'inherit' });

  copyFileSync(nodeBin, outBin);
  chmodSync(outBin, 0o755);

  if (platform === 'darwin') {
    execSync(`codesign --remove-signature "${outBin}"`, { stdio: 'inherit' });
  }

  console.log(`[${name}] injecting blob...`);
  const macFlag = platform === 'darwin' ? '--macho-segment-name NODE_SEA' : '';
  // Use cli.js directly — .bin/postject wrapper is broken on Node 25
  execSync(
    `node node_modules/postject/dist/cli.js "${outBin}" NODE_SEA_BLOB "${blobPath}" --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 ${macFlag}`,
    { stdio: 'inherit' }
  );

  if (platform === 'darwin') {
    execSync(`codesign --sign - "${outBin}"`, { stdio: 'inherit' });
  }

  console.log(`[${name}] done: ${outBin}`);
}

const nodeBin = getSeaNodeBin();
makeSeaBinary({ name: 'ibr',        entry: 'dist/ibr-sea.cjs',        nodeBin });
makeSeaBinary({ name: 'ibr-server', entry: 'dist/ibr-server-sea.cjs', nodeBin });

// Ensure dist/node_modules symlink exists so _seaRequire(process.execPath)
// can resolve external packages (better-sqlite3 etc.) at runtime.
// createRequire(execPath) walks up from the binary's directory — with this
// symlink, it finds node_modules in dist/ itself.
const nmLink = 'dist/node_modules';
const nmTarget = '../node_modules';
try {
  rmSync(nmLink, { recursive: true, force: true });
} catch (_) {}
symlinkSync(nmTarget, nmLink);
console.log(`[sea] symlinked ${nmLink} -> ${nmTarget}`);
