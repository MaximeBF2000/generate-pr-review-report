import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderMarkdown } from '../src/markdown.js';
import { renderReport } from '../src/render.js';
import { validateReview, ValidationError } from '../src/validate.js';

const CLI = fileURLToPath(new URL('../bin/generate-pr-review-report.js', import.meta.url));
const base = { key: 1, title: 'T', summary: 'S', feedbacks: [] };

test('markdown escapes HTML and blocks javascript: links', () => {
  const html = renderMarkdown('<script>x</script> [a](javascript:alert(1)) `<b>`');
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('javascript:'));
  assert.ok(html.includes('<code>&lt;b&gt;</code>'));
});

test('markdown renders lists, headings and code fences', () => {
  const html = renderMarkdown('## Title\n\n- **a**\n- b\n\n```ts\nconst x = 1;\n```');
  assert.match(html, /<h4>Title<\/h4>/);
  assert.match(html, /<ul><li><strong>a<\/strong><\/li><li>b<\/li><\/ul>/);
  assert.match(html, /<pre class="md-code" data-lang="ts"><code>const x = 1;<\/code><\/pre>/);
});

test('validation reports every error with its path', () => {
  assert.throws(
    () => validateReview({ summary: 1, feedbacks: [{ severity: 'huge', file: 'a.js' }] }),
    (err) => err instanceof ValidationError && err.errors.length === 5 && err.errors.some((e) => e.startsWith('feedbacks[0].severity')),
  );
});

test('validation normalizes severity aliases and sorts by severity', () => {
  const r = validateReview({ ...base, feedbacks: [
    { severity: 'nit', file: 'a', text: 't', comment: 'c' },
    { severity: 'Must-Fix', file: 'b', text: 't', comment: 'c', lineStart: 3 },
  ] });
  assert.deepEqual(r.feedbacks.map((f) => f.severity), ['must_fix', 'nit']);
  assert.equal(r.feedbacks[0].lineEnd, 3);
});

test('rendered report cannot break out of the data script tag', () => {
  const html = renderReport(validateReview({ ...base, summary: '</script><img src=x onerror=alert(1)>' }));
  assert.equal(html.match(/<\/script>/g).length, 2);
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!html.includes('{{'));
});

test('CLI accepts inline JSON with --input/--output and writes the file', () => {
  const out = join(mkdtempSync(join(tmpdir(), 'prr-')), 'nested', 'r.html');
  execFileSync('node', [CLI, '--input', JSON.stringify(base), '--output', out]);
  assert.match(readFileSync(out, 'utf8'), /No feedback — PR looks good to go/);
});

test('CLI exits non-zero on invalid input', () => {
  const res = spawnSync('node', [CLI, '-i', '{"title":""}']);
  assert.equal(res.status, 1);
  assert.match(res.stderr.toString(), /title: required/);
});

test('CLI --dark and --size set the report defaults', () => {
  const dir = mkdtempSync(join(tmpdir(), 'prr-'));
  execFileSync('node', [CLI, '-i', JSON.stringify(base), '-o', join(dir, 'a.html')]);
  assert.match(readFileSync(join(dir, 'a.html'), 'utf8'), /<html lang="en" data-theme="light" data-size="m">/);
  execFileSync('node', [CLI, '-i', JSON.stringify(base), '-o', join(dir, 'b.html'), '--dark', '--size', 'L']);
  assert.match(readFileSync(join(dir, 'b.html'), 'utf8'), /<html lang="en" data-theme="dark" data-size="l">/);
});

test('CLI rejects an unknown --size', () => {
  const res = spawnSync('node', [CLI, '-i', JSON.stringify(base), '--size', 'XL']);
  assert.equal(res.status, 2);
  assert.match(res.stderr.toString(), /--size must be S, M or L/);
});
