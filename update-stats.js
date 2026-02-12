import { readFileSync, writeFileSync, renameSync } from 'fs';

const API = 'https://onionoo.torproject.org';
const TEMPLATE_PATH = process.env.TEMPLATE_PATH || '/srv/index.template.html';
const OUTPUT_PATH = process.env.OUTPUT_PATH || '/srv/index.html';

async function update() {
  let html = readFileSync(TEMPLATE_PATH, 'utf-8');
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
  html = html.replace('<!--ONIONOO--><!--/ONIONOO-->',
    `<!--ONIONOO--><script>window.__ONIONOO_DATA__=${payload}</script><!--/ONIONOO-->`);

  const tmpPath = OUTPUT_PATH + '.tmp';
  writeFileSync(tmpPath, html);
  renameSync(tmpPath, OUTPUT_PATH);

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
