import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(import.meta.url), '..', '..');
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const outDir = join(root, 'docs', 'store');
const workDir = mkdtempSync(join(tmpdir(), 'jev-store-'));

function shoot(url, outPath, width, height, { dark = false, virtualTime = 400 } = {}) {
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    `--screenshot=${outPath}`,
    `--window-size=${width},${height}`,
    `--virtual-time-budget=${virtualTime}`,
    `--blink-settings=preferredColorScheme=${dark ? 0 : 1}`,
    url,
  ];
  execFileSync(chrome, args, { stdio: 'pipe' });
}

function trimBottom(path, width) {
  const geometry = execFileSync('magick', [path, '-format', '%@', 'info:']).toString().trim();
  const match = geometry.match(/^(\d+)x(\d+)\+(\d+)\+(\d+)$/);
  if (!match) return;
  const height = Number(match[2]);
  const y = Number(match[4]);
  const bottom = y + height + 24;
  execFileSync('magick', [path, '-crop', `${width}x${bottom}+0+0`, '+repage', path]);
}

function flatten(path) {
  execFileSync('magick', [path, '-background', 'white', '-alpha', 'remove', '-alpha', 'off', path]);
}

function encodeState(state) {
  return Buffer.from(JSON.stringify(state), 'utf8').toString('base64');
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

mkdirSync(outDir, { recursive: true });

const popupHtml = readFileSync(join(root, 'dist', 'popup.html'), 'utf8');
const storeHtml = popupHtml.replace(
  '<script src="popup.js"></script>',
  '<script src="stub.js"></script>\n    <script src="popup.js"></script>'
);
const storeHtmlPath = join(root, 'dist', 'popup-store.html');
writeFileSync(storeHtmlPath, storeHtml);

function popupScenario(name, state, { dark = false } = {}) {
  const encoded = encodeState(state);
  const url = `file://${storeHtmlPath}?state=${encoded}`;
  const raw = join(workDir, `${name}-raw.png`);
  shoot(url, raw, 380, 1600, { dark, virtualTime: 800 });
  trimBottom(raw, 380);
  return raw;
}

const labelsPopup = popupScenario('labels', {
  privacyAck: true,
  provider: 'gateway',
  apiKeyHint: '9c4f',
  threshold: 0.7,
  labels,
  crop: 'labels',
});

const privacyPopup = popupScenario('privacy', {
  privacyAck: false,
  provider: 'gateway',
  apiKeyHint: '',
  labels: [],
  crop: 'privacy',
});

const keyPopup = popupScenario('key', {
  privacyAck: true,
  provider: 'gateway',
  apiKeyHint: 'a1b2',
  threshold: 0.75,
  labels: [],
  crop: 'key',
});

function frameUrl(scene, extra = {}) {
  const params = new URLSearchParams({ scene, ...extra });
  return `file://${join(root, 'dev', 'store', 'frame.html')}?${params.toString()}`;
}

const only = process.env.STORE_IMAGES_ONLY
  ? process.env.STORE_IMAGES_ONLY.split(',').map((name) => name.trim())
  : null;

function finalShot(name, url, width, height, { dark = false } = {}) {
  if (only && !only.includes(name)) return null;
  const out = join(outDir, name);
  shoot(url, out, width, height, { dark, virtualTime: 400 });
  flatten(out);
  return out;
}

finalShot('01-unread-first.png', frameUrl('unread-first'), 1280, 800);
finalShot('03-dark-theme.png', frameUrl('dark-theme'), 1280, 800, { dark: true });
finalShot(
  '02-your-labels.png',
  frameUrl('your-labels', { labelsImg: `file://${labelsPopup}` }),
  1280,
  800
);
finalShot(
  '04-privacy.png',
  frameUrl('privacy', { privacyImg: `file://${privacyPopup}` }),
  1280,
  800
);
finalShot('05-your-key.png', frameUrl('your-key', { keyImg: `file://${keyPopup}` }), 1280, 800);

finalShot(
  'promo-small.png',
  `file://${join(root, 'dev', 'store', 'promo-small.html')}`,
  440,
  280
);
finalShot(
  'promo-marquee.png',
  `file://${join(root, 'dev', 'store', 'promo-marquee.html')}`,
  1400,
  560
);

const docsImages = join(root, 'docs', 'images');
for (const [name, dark] of [
  ['popup-light.png', false],
  ['popup-dark.png', true],
]) {
  if (only && !only.includes(name)) continue;
  const out = join(docsImages, name);
  shoot(
    `file://${storeHtmlPath}?state=${encodeState({
      privacyAck: true,
      provider: 'gateway',
      apiKeyHint: '9c4f',
      threshold: 0.7,
      labels,
    })}`,
    out,
    380,
    1600,
    { dark, virtualTime: 800 }
  );
  trimBottom(out, 380);
  flatten(out);
}

rmSync(workDir, { recursive: true, force: true });
console.log('Store images written to docs/store/, docs/images/ updated.');
