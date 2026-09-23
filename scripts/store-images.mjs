import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(import.meta.url), '..', '..');
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const storeDir = join(root, 'dev', 'store');
const rawDir = join(storeDir, 'raw');
const outDir = join(root, 'docs', 'store');

function shoot(url, outPath, width, height, { scale = 1, scheme, virtualTime = 400 } = {}) {
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--allow-file-access-from-files',
    `--force-device-scale-factor=${scale}`,
    `--screenshot=${outPath}`,
    `--window-size=${width},${height}`,
    `--virtual-time-budget=${virtualTime}`,
  ];
  if (scheme) args.push(`--blink-settings=preferredColorScheme=${scheme === 'dark' ? 0 : 1}`);
  args.push(url);
  execFileSync(chrome, args, { stdio: 'pipe' });
}

function downsize(src, out, width, height) {
  execFileSync('magick', [
    src,
    '-filter',
    'Lanczos',
    '-resize',
    `${width}x${height}!`,
    '-background',
    'white',
    '-alpha',
    'remove',
    '-alpha',
    'off',
    '-define',
    'png:color-type=2',
    out,
  ]);
}

function trimBottom(path, width) {
  const geometry = execFileSync('magick', [path, '-format', '%@', 'info:'])
    .toString()
    .trim()
    .match(/^(\d+)x(\d+)\+(\d+)\+(\d+)$/);
  if (!geometry) return;
  const bottom = Number(geometry[2]) + Number(geometry[4]) + 32;
  execFileSync('magick', [path, '-crop', `${width}x${bottom}+0+0`, '+repage', path]);
}

function fileUrl(...segments) {
  return `file://${join(...segments)}`;
}

const labels = [
  { id: 'visa', name: 'Visa', description: 'Residence permits, IND letters, immigration appointments' },
  { id: 'money', name: 'Money', description: 'Invoices, payments, bank statements' },
  { id: 'home', name: 'Home', description: 'Rent, utilities, landlord and building notices' },
];

if (!existsSync(join(root, 'dist', 'popup.js'))) {
  console.error('dist/ is missing. Run npm run build first.');
  process.exit(1);
}

mkdirSync(rawDir, { recursive: true });
mkdirSync(outDir, { recursive: true });

const popupHtml = readFileSync(join(root, 'dist', 'popup.html'), 'utf8');
const storeHtmlPath = join(root, 'dist', 'popup-store.html');
writeFileSync(
  storeHtmlPath,
  popupHtml.replace(
    '<script src="popup.js"></script>',
    '<script src="stub.js"></script>\n    <script src="popup.js"></script>'
  )
);

function popupRender(name, state) {
  const encoded = Buffer.from(JSON.stringify(state), 'utf8').toString('base64');
  const out = join(rawDir, `${name}.png`);
  shoot(`${fileUrl(storeHtmlPath)}?state=${encoded}`, out, 380, 1400, { scale: 2, scheme: 'light', virtualTime: 800 });
  trimBottom(out, 760);
}

popupRender('popup-set', { privacyAck: true, provider: 'gateway', apiKeyHint: 'a1b2', threshold: 0.7, labels });
popupRender('popup-firstrun', { privacyAck: false, provider: 'gateway', labels });

const scenes = [
  ['hero', '01-unread-first'],
  ['labels', '02-your-labels'],
  ['dark', '03-dark-theme'],
  ['privacy', '04-privacy'],
  ['search', '05-search-and-key'],
];

for (const [scene, name] of scenes) {
  const raw = join(rawDir, `${scene}@2x.png`);
  shoot(`${fileUrl(storeDir, 'scene.html')}?scene=${scene}`, raw, 1440, 900, { scale: 2, virtualTime: 6000 });
  downsize(raw, join(outDir, `${name}.png`), 1280, 800);
}

shoot(`${fileUrl(storeDir, 'scene.html')}?scene=hero&nocallout=1`, join(rawDir, 'hero-clean@2x.png'), 1440, 900, {
  scale: 2,
  virtualTime: 6000,
});

const promos = [
  ['small', 'promo-small.png', 440, 280],
  ['marquee', 'promo-marquee.png', 1400, 560],
];

for (const [size, name, width, height] of promos) {
  const raw = join(rawDir, `promo-${size}@2x.png`);
  shoot(`${fileUrl(storeDir, 'promo.html')}?size=${size}`, raw, width, height, { scale: 2, virtualTime: 6000 });
  downsize(raw, join(outDir, name), width, height);
}

console.log('Store images written to docs/store/.');
