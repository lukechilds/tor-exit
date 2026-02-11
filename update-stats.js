import { readFileSync, writeFileSync, existsSync, mkdirSync, cpSync, readdirSync, renameSync, copyFileSync } from 'fs';
import { join } from 'path';

const API = 'https://onionoo.torproject.org';
const TEMPLATE_DIR = process.env.TEMPLATE_DIR || '/template';
const OUTPUT_DIR = process.env.OUTPUT_DIR || '/www';

function syncStaticFiles() {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  for (const item of readdirSync(TEMPLATE_DIR)) {
    if (item === 'index.html') continue;
    cpSync(join(TEMPLATE_DIR, item), join(OUTPUT_DIR, item), { recursive: true });
  }
}

async function update() {
  const templatePath = join(TEMPLATE_DIR, 'index.html');
  const outputPath = join(OUTPUT_DIR, 'index.html');

  syncStaticFiles();

  if (!existsSync(outputPath)) {
    copyFileSync(templatePath, outputPath);
    console.log('Copied template as initial index.html');
  }

  let html = readFileSync(templatePath, 'utf-8');
  const fingerprint = html.match(/const FINGERPRINT = '([A-F0-9]+)'/)?.[1];
  if (!fingerprint) throw new Error('Could not find FINGERPRINT in template');

  console.log(`Fetching relay data for ${fingerprint.slice(0, 8)}...`);
  const [details, bandwidth] = await Promise.all([
    fetch(`${API}/details?lookup=${fingerprint}`).then(r => r.json()),
    fetch(`${API}/bandwidth?lookup=${fingerprint}`).then(r => r.json()),
  ]);

  if (!details.relays?.[0]) {
    console.log('No relay data found, keeping current version');
    return;
  }

  let payload = JSON.stringify({ details, bandwidth });
  payload = payload.replaceAll('</script>', '<\\/script>');
  payload = payload.replaceAll('<!--', '<\\!--');
  html = html.replace('<!--ONIONOO_PAYLOAD-->', `<script>window.__ONIONOO_DATA__=${payload};</script>`);

  const tmpPath = outputPath + '.tmp';
  writeFileSync(tmpPath, html);
  renameSync(tmpPath, outputPath);

  console.log(`Updated: ${details.relays[0].nickname}`);
}

while (true) {
  try {
    await update();
  } catch (e) {
    console.error('Error:', e.message);
  }
  await Bun.sleep(3600_000);
}
