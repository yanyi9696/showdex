import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import webpack from 'webpack';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
process.env.NODE_ENV = 'production';
process.env.BUILD_TARGET = 'standalone';
process.env.FANTASY_EMBEDDED = 'true';
process.env.PROD_ANALYZE_BUNDLES = 'false';
const { config } = await import('../webpack.config.js');
config.output.path = path.resolve(process.argv[2] || '../pokemon-showdown-client/play.pokemonshowdown.com/showdex');
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
  console.log(stats.toString({ all: false, timings: true, errors: true, warningsCount: true }));
  console.log(`Fantasy Showdex assets: ${config.output.path}`);
});
