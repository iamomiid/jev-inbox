import { context, build } from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';

const watch = process.argv.includes('--watch');

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist');

const common = {
  bundle: true,
  sourcemap: false,
  target: ['chrome114'],
  logLevel: 'info',
  outdir: 'dist',
  define: { 'process.env.NODE_ENV': '"production"' },
};

const entry = (entryPoints, format) => ({ entryPoints, format });

const runs = [
  entry(['src/content.ts'], 'iife'),
  entry(['src/background.ts'], 'esm'),
  entry(['src/popup.ts'], 'iife'),
  entry(['dev/demo.ts'], 'iife'),
];

if (watch) {
  for (const opts of runs) {
    const ctx = await context({ ...common, ...opts });
    await ctx.watch();
  }
  console.log('watching...');
} else {
  await Promise.all(runs.map((opts) => build({ ...common, ...opts })));
}

cpSync('manifest.json', 'dist/manifest.json');
cpSync('src/popup.html', 'dist/popup.html');
cpSync('src/section.css', 'dist/section.css');
cpSync('assets', 'dist/assets', { recursive: true });
