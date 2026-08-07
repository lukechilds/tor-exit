import { describe, expect, test } from 'bun:test';
import { mergeBandwidth } from './update-stats.js';

const fingerprint = 'TESTFINGERPRINT';

function history(first, interval, factor, values) {
  const firstDate = new Date(first.replace(' ', 'T') + 'Z');
  const lastDate = new Date(firstDate.getTime() + (values.length - 1) * interval * 1_000);
  return {
    first,
    last: lastDate.toISOString().replace('T', ' ').slice(0, 19),
    interval,
    factor,
    count: values.length,
    values,
  };
}

function bandwidth(writeHistory, readHistory = writeHistory) {
  return {
    relays: [{
      fingerprint,
      write_history: writeHistory,
      read_history: readHistory,
    }],
  };
}

describe('mergeBandwidth', () => {
  test('prepends archived days, keeps gaps, and appends live days', () => {
    const archived = bandwidth({
      '1_year': history('2026-01-01 00:00:00', 172_800, 10, [1]),
    }).relays[0];
    const live = bandwidth({
      '1_month': history('2026-01-04 12:00:00', 86_400, 5, [2, 3]),
    });

    const merged = mergeBandwidth(archived, live).relays[0].write_history['5_years'];

    expect(merged.first).toBe('2026-01-01 00:00:00');
    expect(merged.last).toBe('2026-01-05 00:00:00');
    expect(merged.factor).toBe(1);
    expect(merged.values).toEqual([10, 10, null, 10, 15]);
  });

  test('uses non-null live values for overlap without erasing known history', () => {
    const archived = bandwidth({
      '6_months': history('2026-01-01 12:00:00', 86_400, 10, [1, 2]),
    }).relays[0];
    const live = bandwidth({
      '1_month': history('2026-01-01 12:00:00', 86_400, 5, [4, null]),
    });

    const merged = mergeBandwidth(archived, live).relays[0].write_history['5_years'];

    expect(merged.values).toEqual([20, 20]);
  });

  test('rejects history from a different relay', () => {
    const archived = bandwidth({
      '1_month': history('2026-01-01 00:00:00', 86_400, 1, [1]),
    }).relays[0];
    archived.fingerprint = 'SOMEONEELSE';

    expect(() => mergeBandwidth(archived, bandwidth({}))).toThrow('fingerprint');
  });
});
