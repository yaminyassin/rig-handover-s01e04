// Contract for the morning digest (plan.md § 1). Types only: the reader is built against this
// file, and so are the page, the JSON route, the board link and the route tests (plan.md § 2).
//
// Input: runs/<night>.jsonl, one JSON object per line:
//   { "at": string, "job": string, "status": "ok" | "retry" | "fail",
//     "owner": string | null, "error"?: string }

export type RunStatus = 'ok' | 'retry' | 'fail';

// A line is VALID when it parses as a JSON object with `at` (string), `job` (string),
// `status` (one of RunStatus), `owner` (string or null; a missing `owner` counts as null) and,
// if present, `error` (string). Any other non-blank line is a BAD line: counted in
// `Night.badLines`, never thrown, and contributes to nothing else. Blank (whitespace-only)
// lines, such as a trailing newline, are skipped and are neither valid nor bad.
//
// "File order" below means the order of lines in the file, not sorted by `at`.

// One row per distinct `job` among the night's valid lines.
export type DigestRow = {
  job: string;
  // `owner` of the job's last valid line in file order. null renders as `—`.
  owner: string | null;
  // Number of valid lines for this job (every status counts, retries included). Always >= 1.
  runs: number;
  // Number of valid lines for this job whose status is 'retry'.
  retries: number;
  // `status` of the job's last valid line in file order.
  lastStatus: RunStatus;
  // `error` of the job's last valid line in file order; null when that line has none, even if
  // an earlier line for the job had one.
  lastError: string | null;
  // `at` of the job's first / last valid line in file order, exactly as written in the log
  // (offset kept, e.g. "2026-10-28T23:00:02+01:00"). Never parsed into a Date, never
  // converted to UTC.
  firstAt: string;
  lastAt: string;
};

export type Night = {
  // The night as asked for, "YYYY-MM-DD".
  night: string;
  // Sorted by `job` ascending, plain string compare (a < b by UTF-16 code units, as
  // `[...].sort()` does; not localeCompare). The page and the JSON both use this order as is,
  // so they never disagree. Empty when the file has no valid lines: render "nothing ran".
  rows: DigestRow[];
  // Number of bad lines (see above). 0 when every non-blank line was valid.
  badLines: number;
  // Number of VALID LINES with each status, across all jobs (not rows, not jobs by last
  // status). counts.ok + counts.retry + counts.fail === sum of rows[].runs. For the board link.
  counts: { ok: number; retry: number; fail: number };
};

// readNight(runsDir, night) reads `${runsDir}/${night}.jsonl`.
// - Returns null when there is no such file (the page answers 404), and also when `night` is
//   not exactly YYYY-MM-DD (so no path outside runsDir is ever read).
// - Returns a Night with rows: [] for an empty file, or one with only blank/bad lines.
// - Never throws for bad content. Synchronous, like nightsOnDisk in src/status.ts.
// Implemented and exported as `readNight` from `src/digest/reader.ts`:
//   import { readNight } from './digest/reader.js';
export type ReadNight = (runsDir: string, night: string) => Night | null;
