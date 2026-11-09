import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/reader.js';

describe('readNight on runs/2026-10-28.jsonl', () => {
  const night = readNight('runs', '2026-10-28');

  it('reads 5 jobs and 1 bad line', () => {
    expect(night).not.toBeNull();
    expect(night?.night).toBe('2026-10-28');
    expect(night?.rows).toHaveLength(5);
    expect(night?.badLines).toBe(1);
  });

  it('sorts rows by job, plain string compare', () => {
    expect(night?.rows.map((r) => r.job)).toEqual([
      'digest/render',
      'fixtures/refresh',
      'lane/sync',
      'notes/backup',
      'rig/rotate-logs',
    ]);
  });

  it('builds each row from the valid lines in file order', () => {
    expect(night?.rows).toEqual([
      {
        job: 'digest/render',
        owner: null,
        runs: 1,
        retries: 0,
        lastStatus: 'ok',
        lastError: null,
        firstAt: '2026-10-29T05:41:09+01:00',
        lastAt: '2026-10-29T05:41:09+01:00',
      },
      {
        job: 'fixtures/refresh',
        owner: 'rook',
        runs: 4,
        retries: 3,
        lastStatus: 'ok',
        lastError: null,
        firstAt: '2026-10-29T01:30:00+01:00',
        lastAt: '2026-10-29T01:37:00+01:00',
      },
      {
        job: 'lane/sync',
        owner: 'rook',
        runs: 8,
        retries: 1,
        lastStatus: 'ok',
        lastError: null,
        firstAt: '2026-10-28T23:00:06+01:00',
        lastAt: '2026-10-29T05:00:04+01:00',
      },
      {
        job: 'notes/backup',
        owner: 'lane-07',
        runs: 1,
        retries: 0,
        lastStatus: 'fail',
        lastError: 'quota exceeded',
        firstAt: '2026-10-29T04:00:01+01:00',
        lastAt: '2026-10-29T04:00:01+01:00',
      },
      {
        job: 'rig/rotate-logs',
        owner: 'lane-07',
        runs: 1,
        retries: 0,
        lastStatus: 'ok',
        lastError: null,
        firstAt: '2026-10-28T23:00:02+01:00',
        lastAt: '2026-10-28T23:00:02+01:00',
      },
    ]);
  });

  it('counts valid lines by status, matching the sum of runs', () => {
    expect(night?.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
    const runs = night?.rows.reduce((n, r) => n + r.runs, 0);
    expect(runs).toBe(15);
  });
});

describe('readNight edge cases', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rig-reader-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('returns null when the file does not exist', () => {
    expect(readNight(dir, '2026-01-01')).toBeNull();
  });

  it('returns null for a night that is not exactly YYYY-MM-DD', () => {
    writeFileSync(join(dir, 'oops.jsonl'), '');
    expect(readNight(dir, 'oops')).toBeNull();
    expect(readNight(dir, '../runs/2026-10-28')).toBeNull();
    expect(readNight('runs', '2026-10-28 ')).toBeNull();
    expect(readNight('runs', '2026-10-28.jsonl')).toBeNull();
  });

  it('returns empty rows for an empty file', () => {
    writeFileSync(join(dir, '2026-02-01.jsonl'), '');
    expect(readNight(dir, '2026-02-01')).toEqual({
      night: '2026-02-01',
      rows: [],
      badLines: 0,
      counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('skips blank lines without counting them as bad', () => {
    const line = JSON.stringify({ at: '2026-03-01T01:00:00+02:00', job: 'a', status: 'ok' });
    writeFileSync(join(dir, '2026-03-01.jsonl'), `\n${line}\n   \n\t\n${line}\n\n`);
    const night = readNight(dir, '2026-03-01');
    expect(night?.badLines).toBe(0);
    expect(night?.rows).toHaveLength(1);
    expect(night?.rows[0]?.runs).toBe(2);
    expect(night?.rows[0]?.owner).toBeNull();
  });

  it('counts lines with wrong shapes as bad and keeps going', () => {
    const lines = [
      '[]',
      'null',
      '"text"',
      JSON.stringify({ at: 'x', job: 'a', status: 'done', owner: null }),
      JSON.stringify({ at: 'x', job: 'a', status: 'ok', owner: 7 }),
      JSON.stringify({ at: 'x', job: 'a', status: 'ok', owner: null, error: 1 }),
      JSON.stringify({ job: 'a', status: 'ok', owner: null }),
      JSON.stringify({ at: 'x', job: 'a', status: 'ok', owner: null }),
    ];
    writeFileSync(join(dir, '2026-04-01.jsonl'), lines.join('\n'));
    const night = readNight(dir, '2026-04-01');
    expect(night?.badLines).toBe(7);
    expect(night?.rows).toHaveLength(1);
    expect(night?.counts).toEqual({ ok: 1, retry: 0, fail: 0 });
  });
});
