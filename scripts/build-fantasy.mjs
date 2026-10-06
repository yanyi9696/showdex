import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import webpack from 'webpack';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
process.env.NODE_ENV = 'production';
process.env.BUILD_TARGET = 'standalone';
process.env.FANTASY_EMBEDDED = 'true';
process.env.PROD_ANALYZE_BUNDLES = 'false';
const { config } = await import('../webpack.config.js');
config.output.path = path.resolve(process.argv[2] || '../pokemon-showdown-client/play.pokemonshowdown.com/showdex');
// The matching editable source is shipped below; avoid an 11 MB debug map in the web release.
config.devtool = false;
// Keep build output readable; no extension packaging or background/content scripts.
config.plugins = config.plugins.filter((plugin) => plugin.constructor.name !== 'ProgressPlugin');
const compiler = webpack(config);
compiler.run((error, stats) => {
  compiler.close(() => {});
  if (error || stats?.hasErrors()) {
    console.error(error || stats.toString({ all: false, errors: true }));
    process.exitCode = 1;
    return;
  }
  fs.copyFileSync(path.join(root, 'LICENSE'), path.join(config.output.path, 'LICENSE-Showdex'));
  fs.writeFileSync(path.join(config.output.path, 'NOTICE.txt'),
    'Showdex by Keith Choison and contributors (AGPL-3.0). Complete source for this client build: source.tar.gz. Build with pnpm install --frozen-lockfile, then node scripts/build-fantasy.mjs <output-directory>.\n');
  execFileSync('tar', ['-czf', path.join(config.output.path, 'source.tar.gz'), '-C', root,
    'src', 'types', 'scripts', 'patches', 'package.json', 'pnpm-lock.yaml', 'webpack.config.js',
    'postcss.config.cjs', 'tsconfig.json', '.env', 'LICENSE', 'README.md'], { stdio: 'inherit' });
  const files = {};
  const collect = (directory, prefix = '') => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const name = `${prefix}${entry.name}`;
      if (entry.isDirectory()) {
        collect(path.join(directory, entry.name), `${name}/`);
      } else if (name !== 'asset-manifest.json' && !name.endsWith('.map')) {
        const contents = fs.readFileSync(path.join(directory, entry.name));
        files[name] = { bytes: contents.length, sha256: createHash('sha256').update(contents).digest('hex') };
      }
    }
  };
  collect(config.output.path);
  let commit = null;
  let dirty = null;
  try {
    commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    dirty = !!execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim();
  } catch { /* Source archives can also be built without a Git checkout. */ }
  fs.writeFileSync(path.join(config.output.path, 'asset-manifest.json'), `${JSON.stringify({
    schemaVersion: 1,
    source: { repository: 'https://github.com/yanyi9696/showdex', commit, dirty, archive: 'source.tar.gz' },
    files,
  }, null, 2)}\n`);
  console.log(stats.toString({ all: false, timings: true, errors: true, warningsCount: true }));
  console.log(`Fantasy Showdex assets: ${config.output.path}`);
});
