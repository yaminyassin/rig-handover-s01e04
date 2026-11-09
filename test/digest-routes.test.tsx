import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { RigConfig } from '../src/config.js';
import type { Night } from '../src/digest/types.js';

// Route tests for GET /digest/:night (HTML) and GET /api/digest/:night (JSON). They run against
// a temp runs dir, never runs/ (read-only real nights).

const runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-routes-'));

const config: RigConfig = {
  adapter: 'shim',
  installed: '2026-10-29T14:06:00+01:00',
  beatEverySeconds: 60,
  runsDir,
};

const NORMAL = '2026-10-29';
const EMPTY = '2026-10-30';
const BAD = '2026-10-31';
const MISSING = '2026-11-01';

const line = (value: Record<string, unknown>) => JSON.stringify(value);

// Normal night: notes/backup is written first and lane/sync second, so file order differs from
// the sorted order the page and JSON must both use. lane/sync retries 3 times, then ok.
// notes/backup fails with a null owner.
const normalLines = [
  line({ at: '2026-10-29T04:00:01+01:00', job: 'notes/backup', status: 'fail', owner: null, error: 'quota exceeded' }),
  line({ at: '2026-10-29T01:00:00+01:00', job: 'lane/sync', status: 'retry', owner: 'rook', error: 'timeout' }),
  line({ at: '2026-10-29T01:05:00+01:00', job: 'lane/sync', status: 'retry', owner: 'rook' }),
  line({ at: '2026-10-29T01:10:00+01:00', job: 'lane/sync', status: 'retry', owner: 'rook' }),
  line({ at: '2026-10-29T01:15:00+01:00', job: 'lane/sync', status: 'ok', owner: 'rook' }),
];

// Bad night: one line that is not JSON, among good ones.
const badLines = [
  line({ at: '2026-10-31T23:00:02+01:00', job: 'rig/rotate-logs', status: 'ok', owner: 'lane-07' }),
  '{"at": "2026-10-31T23:30:00+01:00", "job": ',
  line({ at: '2026-10-31T23:00:06+01:00', job: 'lane/sync', status: 'ok', owner: 'rook' }),
];

beforeAll(() => {
  writeFileSync(join(runsDir, `${NORMAL}.jsonl`), normalLines.join('\n') + '\n');
  writeFileSync(join(runsDir, `${EMPTY}.jsonl`), '');
  writeFileSync(join(runsDir, `${BAD}.jsonl`), badLines.join('\n') + '\n');
});

const previousMarker = process.env.LANE_MARKER;
afterAll(() => {
  if (previousMarker === undefined) delete process.env.LANE_MARKER;
  else process.env.LANE_MARKER = previousMarker;
  rmSync(runsDir, { recursive: true, force: true });
});

describe('GET /digest/:night (HTML)', () => {
  it('answers 200 for a normal night with one table of rows sorted by job', async () => {
    const res = await createApp(config).request(`/digest/${NORMAL}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html.match(/<table/g)).toHaveLength(1);
    const lane = html.indexOf('lane/sync');
    const backup = html.indexOf('notes/backup');
    expect(lane).toBeGreaterThan(-1);
    expect(backup).toBeGreaterThan(lane);
  });

  it('marks rows with 3+ retries or a last status of fail as warn', async () => {
    const html = await (await createApp(config).request(`/digest/${NORMAL}`)).text();
    const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) ?? [];
    const laneRow = rows.find((r) => r.includes('lane/sync'));
    const backupRow = rows.find((r) => r.includes('notes/backup'));
    expect(laneRow).toMatch(/<tr[^>]*class="warn"/);
    expect(backupRow).toMatch(/<tr[^>]*class="warn"/);
  });

  it('renders a null owner as an em dash', async () => {
    const html = await (await createApp(config).request(`/digest/${NORMAL}`)).text();
    const backupRow = (html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) ?? []).find((r) =>
      r.includes('notes/backup'),
    );
    expect(backupRow).toContain('—');
    expect(backupRow).toContain('quota exceeded');
  });

  it('answers 404 for a night with no file', async () => {
    const res = await createApp(config).request(`/digest/${MISSING}`);
    expect(res.status).toBe(404);
  });

  it('shows "nothing ran" for an empty night, still 200', async () => {
    const res = await createApp(config).request(`/digest/${EMPTY}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('nothing ran');
  });

  it('answers 200 for a bad-line night, shows the good rows and the bad-line count', async () => {
    const res = await createApp(config).request(`/digest/${BAD}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('rig/rotate-logs');
    expect(html).toContain('lane/sync');
    expect(html).toContain('1 line could not be read');
    expect(html).not.toContain('1 lines could not be read');
  });

  it('uses the plural for two or more bad lines', async () => {
    writeFileSync(join(runsDir, '2026-11-02.jsonl'), ['not json', 'also not json', line({ at: 'x', job: 'a', status: 'ok', owner: null })].join('\n'));
    const html = await (await createApp(config).request('/digest/2026-11-02')).text();
    expect(html).toContain('2 lines could not be read');
  });

  it('shows the lane marker when LANE_MARKER is set', async () => {
    process.env.LANE_MARKER = 'DIGEST-TEST-MARKER';
    const html = await (await createApp(config).request(`/digest/${NORMAL}`)).text();
    expect(html).toContain('DIGEST-TEST-MARKER');
  });
});

describe('GET /api/digest/:night (JSON)', () => {
  it('answers 200 with the Night object for a normal night', async () => {
    const res = await createApp(config).request(`/api/digest/${NORMAL}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Night;
    expect(body.night).toBe(NORMAL);
    expect(body.badLines).toBe(0);
    expect(body.counts).toEqual({ ok: 1, retry: 3, fail: 1 });
    expect(body.rows.map((r) => r.job)).toEqual(['lane/sync', 'notes/backup']);
    expect(body.rows[1]).toEqual({
      job: 'notes/backup',
      owner: null,
      runs: 1,
      retries: 0,
      lastStatus: 'fail',
      lastError: 'quota exceeded',
      firstAt: '2026-10-29T04:00:01+01:00',
      lastAt: '2026-10-29T04:00:01+01:00',
    });
  });

  it('answers 404 with a JSON error for a night with no file', async () => {
    const res = await createApp(config).request(`/api/digest/${MISSING}`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: unknown };
    expect(typeof body.error).toBe('string');
  });

  it('answers 200 with rows [] for an empty night', async () => {
    const res = await createApp(config).request(`/api/digest/${EMPTY}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Night;
    expect(body.rows).toEqual([]);
  });

  it('answers 200 with badLines 1 for a bad-line night', async () => {
    const res = await createApp(config).request(`/api/digest/${BAD}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Night;
    expect(body.badLines).toBe(1);
    expect(body.rows.map((r) => r.job)).toEqual(['lane/sync', 'rig/rotate-logs']);
  });
});

describe('page and JSON agree', () => {
  it('lists job names in the page in the same order as JSON rows', async () => {
    const page = await createApp(config).request(`/digest/${NORMAL}`);
    const api = await createApp(config).request(`/api/digest/${NORMAL}`);
    expect(page.status).toBe(200);
    expect(api.status).toBe(200);
    const html = await page.text();
    const body = (await api.json()) as Night;
    const positions = body.rows.map((r) => html.indexOf(r.job));
    expect(positions.every((p) => p > -1)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });
});
