import { readFileSync, writeFileSync, renameSync } from 'fs';

const API = 'https://onionoo.torproject.org';
const TEMPLATE_PATH = process.env.TEMPLATE_PATH || '/srv/index.template.html';
const OUTPUT_PATH = process.env.OUTPUT_PATH || '/srv/index.html';
// Saved Onionoo data from before the relay's August 2026 history reset.
const HISTORICAL_BANDWIDTH_PATH = process.env.HISTORICAL_BANDWIDTH_PATH || '/historical-bandwidth.json';
const FIRST_SEEN_OVERRIDE = '2025-09-01 00:00:00';
const DAY_SECONDS = 86_400;
const DAY_MILLISECONDS = DAY_SECONDS * 1_000;

function parseTimestamp(timestamp) {
  const milliseconds = Date.parse(timestamp.replace(' ', 'T') + 'Z');
  if (Number.isNaN(milliseconds)) throw new Error(`Invalid history timestamp: ${timestamp}`);
  return milliseconds;
}

function utcDay(milliseconds) {
  return Math.floor(milliseconds / DAY_MILLISECONDS) * DAY_MILLISECONDS;
}

function historiesToDaily(historySet = {}) {
  const daily = new Map();
  const histories = Object.values(historySet)
    .filter(history => Array.isArray(history.values))
    .sort((a, b) => b.interval - a.interval || b.values.length - a.values.length);

  // Start with long, coarse histories and overlay the more precise recent ones.
  for (const history of histories) {
    const interval = Number(history.interval);
    const factor = Number(history.factor);
    const first = parseTimestamp(history.first);
    const historyDays = new Map();

    history.values.forEach((value, index) => {
      const sampleStart = first + index * interval * 1_000;
      const rate = value === null ? null : Number(value) * factor;

      if (interval >= DAY_SECONDS && interval % DAY_SECONDS === 0) {
        for (let offset = 0; offset < interval; offset += DAY_SECONDS) {
          historyDays.set(utcDay(sampleStart + offset * 1_000), rate);
        }
        return;
      }

      // Preserve the byte total if Onionoo ever returns sub-day buckets.
      const day = utcDay(sampleStart);
      if (rate === null) {
        if (!historyDays.has(day)) historyDays.set(day, null);
      } else {
        const contribution = rate * interval / DAY_SECONDS;
        historyDays.set(day, (historyDays.get(day) || 0) + contribution);
      }
    });

    for (const [day, value] of historyDays) daily.set(day, value);
  }

  return daily;
}

function mergeDaily(archived, live) {
  const merged = historiesToDaily(archived);
  for (const [day, value] of historiesToDaily(live)) {
    // Prefer restored live samples, but do not replace known history with null.
    if (value !== null || !merged.has(day)) merged.set(day, value);
  }
  return merged;
}

function formatHistoryTimestamp(milliseconds) {
  return new Date(milliseconds).toISOString().slice(0, 10) + ' 00:00:00';
}

function buildHistory(daily, first, last) {
  const values = [];
  for (let day = first; day <= last; day += DAY_MILLISECONDS) {
    values.push(daily.has(day) ? daily.get(day) : null);
  }
  return {
    first: formatHistoryTimestamp(first),
    last: formatHistoryTimestamp(last),
    interval: DAY_SECONDS,
    factor: 1,
    count: values.length,
    values,
  };
}

export function mergeBandwidth(historicalRelay, liveBandwidth) {
  const liveRelay = liveBandwidth.relays?.[0];
  if (!liveRelay) return liveBandwidth;
  if (historicalRelay.fingerprint !== liveRelay.fingerprint) {
    throw new Error('Historical bandwidth fingerprint does not match live relay');
  }

  const writeDaily = mergeDaily(historicalRelay.write_history, liveRelay.write_history);
  const readDaily = mergeDaily(historicalRelay.read_history, liveRelay.read_history);
  const days = [...new Set([...writeDaily.keys(), ...readDaily.keys()])].sort((a, b) => a - b);
  if (!days.length) return liveBandwidth;

  const first = days[0];
  const last = days.at(-1);
  const mergedRelay = {
    ...liveRelay,
    write_history: {
      ...liveRelay.write_history,
      '5_years': buildHistory(writeDaily, first, last),
    },
    read_history: {
      ...liveRelay.read_history,
      '5_years': buildHistory(readDaily, first, last),
    },
  };

  return { ...liveBandwidth, relays: [mergedRelay, ...liveBandwidth.relays.slice(1)] };
}

export async function update() {
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

  const historicalRelay = JSON.parse(readFileSync(HISTORICAL_BANDWIDTH_PATH, 'utf-8'));
  const mergedBandwidth = mergeBandwidth(historicalRelay, bandwidth);
  let payload = JSON.stringify({ details, bandwidth: mergedBandwidth });
  payload = payload.replaceAll('</script>', '<\\/script>');
  payload = payload.replaceAll('<!--', '<\\!--');
  const firstSeenOverride = JSON.stringify(FIRST_SEEN_OVERRIDE);
  const markerRe = /<!--ONIONOO-->([\s\S]*?)<!--\/ONIONOO-->/;
  if (!markerRe.test(html)) {
    throw new Error('Could not find ONIONOO markers in template');
  }
  html = html.replace(markerRe,
    `<!--ONIONOO--><script>window.__FIRST_SEEN_OVERRIDE__=${firstSeenOverride};window.__ONIONOO_DATA__=${payload}</script><!--/ONIONOO-->`);

  const tmpPath = OUTPUT_PATH + '.tmp';
  writeFileSync(tmpPath, html);
  renameSync(tmpPath, OUTPUT_PATH);

  console.log(`Updated: ${details.relays[0].nickname}`);
}

if (import.meta.main) {
  while (true) {
    try {
      await update();
    } catch (e) {
      console.error('Error:', e.message);
    }
    await Bun.sleep(3600_000);
  }
}
