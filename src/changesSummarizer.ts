import * as childProcess from 'child_process';
import * as util from 'util';

const exec = util.promisify(childProcess.exec);

type FileChange = { file: string; change: string };

/**
 * Run git command in cwd and return stdout
 */
async function runGit(cwd: string, cmd: string): Promise<string> {
  const { stdout } = await exec(cmd, { cwd });
  return String(stdout || '').trim();
}

/**
 * Get list of staged files (names only)
 */
export async function getStagedFiles(cwd: string): Promise<string[]> {
  // --name-only lists filenames only
  const out = await runGit(cwd, 'git diff --staged --name-only');
  if (!out) {
    return [];
  }
  return out.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
}

/**
 * Produce a very short analysis of a file's staged diff.
 * Heuristic: call git diff --staged -- <file> and extract first changed lines summary
 */
export async function analyzeFileChange(cwd: string, file: string): Promise<string> {
  try {
    const diff = await runGit(cwd, `git diff --staged --numstat -- "${file.replace(/"/g, '\\"')}"`);
    if (!diff) {
      return 'unchanged';
    }

    // numstat: added\tremoved\tfile
    const parts = diff.split(/\r?\n/)[0].split(/\t/);
    if (parts.length >= 3) {
      const a = parts[0] === '-' ? 0 : parseInt(parts[0], 10) || 0;
      const r = parts[1] === '-' ? 0 : parseInt(parts[1], 10) || 0;
      return `${a}+/${r}-`;
    }

    // fallback - take small sample of diff hunks
    const hunks = await runGit(cwd, `git diff --staged --unified=0 -- "${file.replace(/"/g, '\\"')}"`);
    if (!hunks) {
      return 'mod';
    }
    // pick first non-empty line, trimmed and collapsed
    const first = hunks.split(/\r?\n/).map(l => l.trim()).find(Boolean) || 'mod';
    return first.slice(0, 40).replace(/\s+/g, ' ');
  } catch (e) {
    return 'err';
  }
}

/**
 * Build an array of per-file compact summaries: {file, change}
 */
export async function buildFileChanges(cwd: string): Promise<FileChange[]> {
  const files = await getStagedFiles(cwd);
  const out: FileChange[] = [];
  for (const f of files) {
    const change = await analyzeFileChange(cwd, f);
    out.push({ file: f, change });
  }
  return out;
}

/**
 * Take per-file summaries and iteratively compress them into a JSON string <= maxLen.
 * Strategy:
 *  - Start with file:change for each entry joined by ',' inside an object {files:[...]}.
 *  - If too long, progressively shorten each change to smaller tokens: first full change -> short token -> single char.
 *  - If still too long, drop lower-priority files from the end.
 */
export function compressToJson(fileChanges: FileChange[], maxLen = 400): string {
  if (!fileChanges || fileChanges.length === 0) {
    return JSON.stringify({ files: [] });
  }

  // Helper to serialize with given map function
  const serialize = (arr: FileChange[], mapFn: (c: string, f: string) => string) => {
    const items = arr.map(fc => `{\"f\":\"${escapeStr(fc.file)}\",\"c\":\"${escapeStr(mapFn(fc.change, fc.file))}\"}`);
    return `{\"files\": [${items.join(',')}]}`;
  };

  // escape basic quotes/backslashes
  const escapeStr = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r');

  // tiered map functions
  const maps: Array<(c: string, f: string) => string> = [];
  maps.push((c) => c); // full
  maps.push((c) => c.slice(0, 12)); // short
  maps.push((c) => c.slice(0, 6));
  maps.push((c) => c.slice(0, 3));
  maps.push((c) => c.slice(0, 1));

  // Try progressively using maps, and if still too long, drop files from the end
  for (let m = 0; m < maps.length; m++) {
    for (let keep = fileChanges.length; keep > 0; keep--) {
      const arr = fileChanges.slice(0, keep);
      const s = serialize(arr, maps[m]);
      if (s.length <= maxLen) {
        return s;
      }
    }
  }

  // As a last resort, return an empty files array
  return JSON.stringify({ files: [] });
}

export default {
  getStagedFiles,
  analyzeFileChange,
  buildFileChanges,
  compressToJson,
};
