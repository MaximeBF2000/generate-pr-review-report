// Reads the full content of the files referenced by the review, so the report
// can show them (context lines, full-file viewer) without the AI agent having
// to repeat any code in its JSON.
//
// Each feedback's `absolute_path` is read directly. When it is missing or
// wrong, the relative `file` is looked up in a few likely folders instead.
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

export const MAX_FILE_BYTES = 1_000_000;

function realDir(path) {
  try {
    const real = realpathSync(resolve(path));
    return statSync(real).isDirectory() ? real : null;
  } catch {
    return null;
  }
}

function gitTopLevel(cwd) {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || null;
  } catch {
    return null;
  }
}

// Fallback folders for relative paths: the git repository of the current
// directory, then the current directory, each followed by its parent folder
// so a review spanning sibling repositories ("other-repo/src/x.js") resolves.
export function searchRoots(cwd = process.cwd()) {
  const roots = [];
  for (const root of [gitTopLevel(cwd), cwd].map((d) => d && realDir(d)).filter(Boolean)) {
    for (const dir of [root, dirname(root)]) if (!roots.includes(dir)) roots.push(dir);
  }
  return roots;
}

// Reads one text file. With `root`, the file must resolve inside it (a
// relative path can't climb out with "../").
function readTextFile(path, root) {
  let real;
  try {
    real = realpathSync(root ? resolve(root, path) : path);
  } catch {
    return { missing: true };
  }
  if (root) {
    const rel = relative(root, real);
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return { missing: true };
  }
  const stat = statSync(real);
  if (!stat.isFile()) return { missing: true };
  if (stat.size > MAX_FILE_BYTES) return { skipped: 'larger than 1 MB' };
  const buffer = readFileSync(real);
  if (buffer.includes(0)) return { skipped: 'binary file' };
  return { text: buffer.toString('utf8').replace(/\r\n?/g, '\n') };
}

// `entries` holds { file, absolutePath } items (or plain relative paths).
// Returns { files: { [file]: text }, warnings: string[] }. Never throws: a
// file that can't be read is reported in warnings and the report still renders.
export function loadReviewFiles(entries, { cwd = process.cwd() } = {}) {
  const byFile = new Map();
  for (const entry of entries) {
    const { file, absolutePath } = typeof entry === 'string' ? { file: entry } : entry;
    if (!byFile.get(file)) byFile.set(file, absolutePath);
  }

  let roots;
  const files = {};
  const warnings = [];
  for (const [file, absolutePath] of byFile) {
    let result = { missing: true };
    if (absolutePath) {
      result = readTextFile(absolutePath);
      if (result.missing) warnings.push(`absolute_path not found, searching for ${file} instead: ${absolutePath}`);
    }
    if (result.missing && !isAbsolute(file)) {
      roots ??= searchRoots(cwd);
      for (const root of roots) {
        result = readTextFile(file, root);
        if (!result.missing) break;
      }
    }
    if (result.text != null) files[file] = result.text;
    else warnings.push(`${result.skipped ?? 'file not found'}, no code shown for: ${file}`);
  }
  return { files, warnings };
}
