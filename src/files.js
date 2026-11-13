// Reads the full content of the files referenced by the review, so the report
// can show them without the AI agent having to repeat them in its JSON.
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

export const MAX_FILE_BYTES = 1_000_000;

// Returns { files: { [relativePath]: text }, warnings: string[] }.
// Problems never throw: a file that can't be read is skipped with a warning,
// and the report still renders (that file just has no viewer).
export function loadRepositoryFiles(root, paths) {
  const files = {};
  const warnings = [];
  let realRoot;
  try {
    realRoot = realpathSync(resolve(root));
    if (!statSync(realRoot).isDirectory()) throw new Error();
  } catch {
    return { files, warnings: [`repository_root is not a readable directory: ${root} (file viewer disabled)`] };
  }

  for (const path of new Set(paths)) {
    let real;
    try {
      real = realpathSync(resolve(realRoot, path));
    } catch {
      warnings.push(`file not found in repository_root, skipped: ${path}`);
      continue;
    }
    const rel = relative(realRoot, real);
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      warnings.push(`file is outside repository_root, skipped: ${path}`);
      continue;
    }
    const stat = statSync(real);
    if (!stat.isFile()) { warnings.push(`not a regular file, skipped: ${path}`); continue; }
    if (stat.size > MAX_FILE_BYTES) { warnings.push(`file larger than 1 MB, skipped: ${path}`); continue; }
    const buffer = readFileSync(real);
    if (buffer.includes(0)) { warnings.push(`binary file, skipped: ${path}`); continue; }
    files[path] = buffer.toString('utf8').replace(/\r\n?/g, '\n');
  }
  return { files, warnings };
}
