import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { escapeHtml, renderMarkdown } from './markdown.js';

const TEMPLATE_PATH = fileURLToPath(new URL('../templates/report.html', import.meta.url));

const SEVERITY = {
  must_fix: { label: 'Must fix', short: 'must fix', className: 'must-fix' },
  should_consider: { label: 'Consider', short: 'consider', className: 'consider' },
  nit: { label: 'Nit', short: 'nit', className: 'nit' },
};

const svg = (body, size = 16, extra = '') =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${body}</svg>`;

export const ICONS = {
  pr: svg('<circle cx="6" cy="6" r="2.4"/><circle cx="6" cy="18" r="2.4"/><circle cx="18" cy="18" r="2.4"/><path d="M6 8.4v7.2"/><path d="M18 15.6V9a3 3 0 0 0-3-3h-4"/><path d="m13 3.5-2.5 2.5L13 8.5"/>', 22, ' stroke-width="2"'),
  summary: svg('<rect x="4" y="3.5" width="16" height="17" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>', 21),
  comments: svg('<path d="M20 12a7.5 7.5 0 0 1-11.1 6.6L4 20l1.4-4.6A7.5 7.5 0 1 1 20 12Z"/><path d="M9 10.5h6M9 13.5h3.5"/>', 21),
  file: svg('<path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5Z"/><path d="M14 3.5v5h5"/>', 13),
  comment: svg('<path d="M20 12a7.5 7.5 0 0 1-11.1 6.6L4 20l1.4-4.6A7.5 7.5 0 1 1 20 12Z"/>', 13),
  diff: svg('<path d="M12 4v8M8 8h8M8 18h8"/>', 14, ' stroke-width="2"'),
  copy: svg('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>', 15),
  check: svg('<path d="m5 12 5 5L20 7"/>', 15, ' stroke-width="2.6"'),
  chevron: svg('<path d="m6 9 6 6 6-6"/>', 18, ' stroke-width="2"'),
  external: svg('<path d="M7 17 17 7M8 7h9v9"/>', 15, ' stroke-width="2"'),
  branch: svg('<circle cx="6" cy="5.5" r="2"/><circle cx="6" cy="18.5" r="2"/><circle cx="18" cy="8" r="2"/><path d="M6 7.5v9M18 10c0 4-5 3.5-10.5 7"/>', 13),
  doc: svg('<rect x="5" y="4" width="14" height="16" rx="2"/><path d="M9 9h6M9 13h6M9 17h3"/>', 15),
  readyCheck: svg('<path d="m5 12 5 5L20 7"/>', 16, ' stroke-width="2.8"'),
};

const pluralize = (n, word, plural = `${word}s`) => `${fmt(n)} ${n === 1 ? word : plural}`;
const fmt = (n) => n.toLocaleString('en-US');

export function locationLabel(fb) {
  if (fb.lineStart == null) return fb.file;
  return fb.lineStart === fb.lineEnd ? `${fb.file}:${fb.lineStart}` : `${fb.file}:${fb.lineStart}-${fb.lineEnd}`;
}

function prLabel(review) {
  if (review.key == null || review.key === '') return '';
  const key = String(review.key);
  return /^\d+$/.test(key) ? `#${key}` : key;
}

// Parses a unified-diff-like suggestion ("+added", "-removed", " context")
// into rows. A "@@ -a,b +c,d @@" header, if present, gives the start line.
export function parseSuggestion(suggestion) {
  const rows = [];
  let headerStart = null;
  for (const raw of suggestion.split(/\r?\n/)) {
    if (/^(@@|\+\+\+ |--- |\\ No newline)/.test(raw)) {
      const hunk = raw.match(/^@@ -(\d+)/);
      if (hunk && headerStart == null) headerStart = Number(hunk[1]);
      continue;
    }
    const sign = raw[0];
    if (sign === '+') rows.push({ type: 'added', code: raw.slice(1) });
    else if (sign === '-') rows.push({ type: 'removed', code: raw.slice(1) });
    else rows.push({ type: 'context', code: sign === ' ' ? raw.slice(1) : raw });
  }
  return { rows, headerStart };
}

// Finds the line where the suggestion's "before" side (context + removed
// lines) starts in the real file. Indentation differences are tolerated, and
// the match closest to the finding's lineStart wins. Returns null if absent.
export function locateSuggestion(rows, fileText, lineStart) {
  const before = rows.filter((r) => r.type !== 'added').map((r) => r.code.trim());
  if (fileText == null || !before.length) return null;
  const lines = fileText.split('\n');
  let best = null;
  for (let i = 0; i + before.length <= lines.length; i++) {
    let ok = true;
    for (let j = 0; j < before.length && ok; j++) ok = lines[i + j].trim() === before[j];
    if (ok && (best == null || Math.abs(i + 1 - (lineStart ?? 1)) < Math.abs(best - (lineStart ?? 1)))) best = i + 1;
  }
  return best;
}

// Start line of the suggestion in the file: located in the real file when
// possible, else the diff header, else the finding's lineStart.
function suggestionStart(fb, rows, headerStart, fileText) {
  const located = locateSuggestion(rows, fileText, fb.lineStart);
  if (located != null) return located;
  if (headerStart != null) return headerStart;
  // Pure additions with a file: insert right after the commented range.
  if (fileText != null && rows.every((r) => r.type === 'added') && fb.lineEnd != null) return fb.lineEnd + 1;
  return fb.lineStart ?? null;
}

function numberDiffRows(rows, start) {
  let oldLine = start;
  let newLine = start;
  return rows.map((r) => {
    let num = null;
    if (r.type === 'added') { num = newLine; if (newLine != null) newLine++; }
    else if (r.type === 'removed') { num = oldLine; if (oldLine != null) oldLine++; }
    else { num = newLine; if (oldLine != null) oldLine++; if (newLine != null) newLine++; }
    return { ...r, num };
  });
}

export const SNIPPET_CONTEXT = 3;
const SNIPPET_MAX_TARGET_LINES = 30;

// Without a suggestion: the commented lines plus a few lines of context,
// read from the real file. Long ranges are cut, the full file viewer has the rest.
function snippetRows(fb, fileText) {
  if (fileText == null || fb.lineStart == null) return null;
  const lines = fileText.split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  if (fb.lineStart > lines.length) return null;
  const targetEnd = Math.min(fb.lineEnd, fb.lineStart + SNIPPET_MAX_TARGET_LINES - 1);
  const from = Math.max(1, fb.lineStart - SNIPPET_CONTEXT);
  const to = Math.min(lines.length, targetEnd + SNIPPET_CONTEXT);
  const rows = [];
  for (let n = from; n <= to; n++) {
    rows.push({ type: n >= fb.lineStart && n <= fb.lineEnd ? 'context hl' : 'context', num: n, code: lines[n - 1] });
  }
  return { rows, cut: fb.lineEnd > targetEnd ? fb.lineEnd - targetEnd : 0 };
}

// The code block of a finding: the suggestion as a diff, or else the commented
// lines from the file, with a "View full file" button when the file is embedded.
function renderCodeBlock(fb, diff, fileText, hasFile) {
  const sign = { added: '+', removed: '−', context: '', 'context hl': '' };
  let label;
  let rows = null;
  let cut = 0;
  if (diff) {
    label = 'Code suggestion';
    rows = numberDiffRows(diff.rows, diff.start);
  } else {
    const snippet = snippetRows(fb, fileText);
    if (snippet) ({ rows, cut } = snippet);
    label = rows ? 'Code' : 'File';
  }
  // The file couldn't be read when the report was generated: still show the
  // button, disabled, so the reader knows why there is no code.
  const viewButton = hasFile
    ? `<button type="button" class="view-file-button" data-action="view-file" aria-expanded="false" aria-controls="file-viewer-${fb.id}">${ICONS.file}<span>View full file</span></button>`
    : `<button type="button" class="view-file-button" disabled title="${escapeHtml(`${fb.file} wasn't found when the report was generated. Give the feedback an absolute_path, or run the CLI from the repository.`)}">${ICONS.file}<span>File not available</span></button>`;
  const block = rows
    ? `<div class="code-diff" role="figure" aria-label="${diff ? 'Suggested code change' : 'Commented code'}">${rows.map((r) =>
      `<div class="code-line ${r.type}"><span class="line-num">${r.num ?? ''}</span><span class="code-sign">${sign[r.type]}</span><span class="code-text">${escapeHtml(r.code) || ' '}</span></div>`).join('')}${cut
      ? `<div class="code-line context code-more"><span class="line-num"></span><span class="code-sign"></span><span class="code-text">… ${cut} more commented line${cut === 1 ? '' : 's'}</span></div>` : ''}</div>`
    : '';
  return `<div class="field-label code-label">${diff ? ICONS.diff : ICONS.file}${label}${viewButton}</div>
            ${block}
            ${hasFile ? `<div class="file-viewer" id="file-viewer-${fb.id}" hidden></div>` : ''}`;
}

function renderFinding(fb, hasFile, diff, fileText) {
  const sev = SEVERITY[fb.severity];
  const location = locationLabel(fb);
  const locationHtml = hasFile
    ? `<button type="button" class="file-location clickable" data-action="view-file" aria-expanded="false" aria-controls="file-viewer-${fb.id}" title="Show the full file">${ICONS.file}${escapeHtml(location)}${ICONS.chevron}</button>`
    : `<span class="file-location" title="${escapeHtml(location)}">${escapeHtml(location)}</span>`;
  return `
        <article class="finding expanded" id="finding-${fb.id}" data-id="${fb.id}" data-severity="${sev.className}">
          <div class="finding-top">
            <button type="button" class="chevron" aria-label="Toggle details" aria-expanded="true" aria-controls="finding-body-${fb.id}" data-action="toggle">${ICONS.chevron}</button>
            <span class="severity ${sev.className}"><span class="dot ${sev.className}"></span>${sev.label}</span>
            <div class="finding-title-row">
              <button type="button" class="finding-name" data-action="toggle">${escapeHtml(fb.title)}</button>
              ${locationHtml}
              <button type="button" class="copy-icon" title="Copy file path" aria-label="Copy file path" data-action="copy" data-copy="${escapeHtml(location)}">${ICONS.copy}${ICONS.check}</button>
            </div>
            <label class="selection" title="Include in copied review"><input type="checkbox" checked data-action="select" aria-label="Include “${escapeHtml(fb.title)}” in copied review" /></label>
          </div>
          <div class="finding-body" id="finding-body-${fb.id}">
            <div class="explanation md">${renderMarkdown(fb.text)}</div>
            <div class="field-label">${ICONS.comment}Suggested comment</div>
            <div class="comment-area">
              <textarea id="comment-${fb.id}" rows="${Math.min(8, Math.max(2, Math.ceil(fb.comment.length / 110) + (fb.comment.match(/\n/g)?.length ?? 0)))}" aria-label="Suggested comment for ${escapeHtml(fb.title)}" spellcheck="true">${escapeHtml(fb.comment)}</textarea>
              <button type="button" class="copy-icon" title="Copy comment" aria-label="Copy comment" data-action="copy" data-copy-from="comment-${fb.id}">${ICONS.copy}${ICONS.check}</button>
            </div>
            ${renderCodeBlock(fb, diff, fileText, hasFile)}
          </div>
        </article>`;
}

const EMPTY_ILLUSTRATION = `<svg class="empty-illustration" viewBox="0 0 320 190" aria-hidden="true">
  <ellipse class="ill-shadow" cx="160" cy="172" rx="82" ry="9"/>
  <g class="ill-cloud"><path d="M38 128a20 20 0 0 1 38-8 15 15 0 0 1 22 13H38z"/><path d="M224 136a16 16 0 0 1 30-6 12 12 0 0 1 18 10h-48z"/></g>
  <path class="ill-badge" d="M160 34l14 10 17-1 6 16 14 9-5 16 5 16-14 9-6 16-17-1-14 10-14-10-17 1-6-16-14-9 5-16-5-16 14-9 6-16 17 1z" stroke-width="3" stroke-linejoin="round"/>
  <path class="ill-check" d="M138 101l15 15 30-32" fill="none" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
  <g class="ill-spark" stroke-width="4" stroke-linecap="round"><path d="M207 22l-3 13"/><path d="M226 34l-9 9"/><path d="M233 55l-13 2"/></g>
</svg>`;

export const SIZES = ['s', 'm', 'l'];
export const THEMES = ['light', 'dark'];

export function renderReport(review, { generatedAt = new Date(), size = 'm', theme = 'light', files = {} } = {}) {
  if (!SIZES.includes(size)) throw new Error(`size must be one of ${SIZES.join(', ')}`);
  if (!THEMES.includes(theme)) throw new Error(`theme must be one of ${THEMES.join(', ')}`);
  const template = readFileSync(TEMPLATE_PATH, 'utf8');
  const fbs = review.feedbacks;
  const counts = Object.fromEntries(Object.keys(SEVERITY).map((k) => [k, fbs.filter((f) => f.severity === k).length]));
  const pr = prLabel(review);
  const diffs = new Map(fbs.filter((f) => f.suggestion).map((f) => {
    const { rows, headerStart } = parseSuggestion(f.suggestion);
    const fileText = Object.hasOwn(files, f.file) ? files[f.file] : undefined;
    // Only place the diff inside the full file when we know exactly where it goes.
    const located = fileText != null && (locateSuggestion(rows, fileText, f.lineStart) != null || rows.every((r) => r.type === 'added'));
    return [f.id, { rows, start: suggestionStart(f, rows, headerStart, fileText), located }];
  }));
  const usedFiles = Object.fromEntries(Object.entries(files).filter(([path]) => fbs.some((f) => f.file === path)));

  const meta = [];
  if (review.author) meta.push(`<span>by @${escapeHtml(review.author)}</span>`);
  if (review.numberOfFilesChanged != null) meta.push(`<span>${pluralize(review.numberOfFilesChanged, 'file')} changed</span>`);
  const lines = [];
  if (review.numberOfLinesAdded != null) lines.push(`<span class="add">+${fmt(review.numberOfLinesAdded)}</span>`);
  if (review.numberOfLinesDeleted != null) lines.push(`<span class="del">−${fmt(review.numberOfLinesDeleted)}</span>`);
  if (lines.length) meta.push(lines.join(' '));
  if (review.branch) meta.push(`<span class="branch-pill" title="Branch">${ICONS.branch}${escapeHtml(review.branch)}</span>`);

  const header = `
    <header class="pr-header">
      <div class="pr-left">
        <div class="pr-icon">${ICONS.pr}</div>
        <div>
          <h1 class="pr-title">${pr ? `<span class="pr-number">${escapeHtml(pr)}</span>` : ''}${escapeHtml(review.title)}</h1>
          ${meta.length ? `<div class="pr-meta">${meta.join('<span class="sep">•</span>')}</div>` : ''}
        </div>
      </div>
      ${review.url ? `<a class="button" href="${escapeHtml(review.url)}" target="_blank" rel="noopener noreferrer">View PR ${ICONS.external}</a>` : ''}
    </header>`;

  const pills = [];
  if (review.numberOfFilesChanged != null) pills.push(`<span class="stat-pill">${ICONS.file}${pluralize(review.numberOfFilesChanged, 'file')} changed</span>`);
  if (review.numberOfLinesAdded != null) pills.push(`<span class="stat-pill add">+${fmt(review.numberOfLinesAdded)} additions</span>`);
  if (review.numberOfLinesDeleted != null) pills.push(`<span class="stat-pill del">−${fmt(review.numberOfLinesDeleted)} deletions</span>`);
  pills.push(`<span class="stat-pill">${ICONS.comment}${pluralize(fbs.length, 'comment')}</span>`);
  for (const [key, sev] of Object.entries(SEVERITY)) {
    pills.push(`<span class="stat-pill"><span class="dot ${sev.className}"></span>${counts[key]} ${sev.short}</span>`);
  }

  const summary = `
      <section class="card summary-card" aria-labelledby="summary-title">
        <div class="summary-heading">
          <h2 class="section-title" id="summary-title"><span class="section-icon">${ICONS.summary}</span>Summary</h2>
          <div class="summary-stats" aria-label="PR at a glance">${pills.join('')}</div>
        </div>
        <div class="summary-text md">${renderMarkdown(review.summary) || '<p class="muted">No summary provided.</p>'}</div>
      </section>`;

  const copyReviewBtn = `<button type="button" class="button small" data-action="copy-review" title="Copy the review as Markdown (selected comments only)">${ICONS.doc}Copy review</button>`;
  const readyPill = `<span class="ready-pill">${ICONS.readyCheck}Ready to merge</span>`;

  const toolbarRight = fbs.length
    ? `<div class="filters" role="group" aria-label="Filter by severity">
            <button type="button" class="filter active" data-action="filter" data-filter="all" aria-pressed="true">All (${fbs.length})</button>
            ${Object.entries(SEVERITY).map(([key, sev]) => `<button type="button" class="filter" data-action="filter" data-filter="${sev.className}" aria-pressed="false"${counts[key] ? '' : ' disabled'}><span class="dot ${sev.className}"></span>${sev.label} (${counts[key]})</button>`).join('\n            ')}
          </div>${copyReviewBtn}`
    : `${readyPill}${copyReviewBtn}`;

  const body = fbs.length
    ? `<div id="findings">${fbs.map((f) => renderFinding(f, Object.hasOwn(usedFiles, f.file), diffs.get(f.id), usedFiles[f.file])).join('')}
        <div class="empty-filter" hidden>No comments match this filter.</div>
      </div>`
    : `<div class="empty-state">
        ${EMPTY_ILLUSTRATION}
        <h3>No feedback — PR looks good to go</h3>
        <p>The AI review didn’t find any issues worth commenting on.</p>
        <div class="empty-actions">${readyPill.replace('ready-pill', 'ready-pill large')}${copyReviewBtn.replace('button small', 'button')}</div>
      </div>`;

  const reviews = `
      <section class="card reviews-card" aria-labelledby="reviews-title">
        <div class="review-toolbar">
          <h2 class="section-title" id="reviews-title"><span class="section-icon">${ICONS.comments}</span>Review comments <span class="count" id="shown-count">(${fbs.length})</span></h2>
          <div class="toolbar-right">${toolbarRight}</div>
        </div>
        ${body}
      </section>`;

  // Data used by the in-page script to build the Markdown export.
  const data = {
    pr, title: review.title, url: review.url, branch: review.branch, author: review.author,
    fileCount: review.numberOfFilesChanged, added: review.numberOfLinesAdded, deleted: review.numberOfLinesDeleted,
    summary: review.summary,
    feedbacks: fbs.map((f) => {
      const diff = diffs.get(f.id);
      return {
        id: f.id, severity: SEVERITY[f.severity].label, title: f.title, location: locationLabel(f),
        file: f.file, lineStart: f.lineStart, lineEnd: f.lineEnd,
        text: f.text, comment: f.comment, suggestion: f.suggestion,
        // Where the suggestion goes in the full file, for the file viewer.
        hunk: diff?.located && diff.start != null ? { start: diff.start, rows: diff.rows.map((r) => [r.type, r.code]) } : undefined,
      };
    }),
    // Each file once, however many findings point at it.
    files: usedFiles,
  };
  // Escape "<" so no string in the payload can close the <script> tag.
  const dataJson = JSON.stringify(data).replace(/</g, '\\u003c').replace(/[\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16)}`);

  const generated = generatedAt.toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const replacements = {
    PAGE_TITLE: escapeHtml(`AI PR Review — ${pr ? `${pr} ` : ''}${review.title}`),
    GENERATED_AT: escapeHtml(generated),
    GENERATED_ISO: escapeHtml(generatedAt.toISOString()),
    HEADER: header,
    SUMMARY: summary,
    REVIEWS: reviews,
    DATA_JSON: dataJson,
    SIZE: size,
    THEME: theme,
    APP_SCRIPT: '',
  };
  return fillTemplate(template, replacements);
}

function fillTemplate(template, replacements) {
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (match, name) => (name in replacements ? replacements[name] : match));
}

const APP_BRIDGE_PATH = fileURLToPath(new URL('../templates/mcp-app.js', import.meta.url));

// The page an MCP host shows for the report tool: the report template with
// no review in it yet, plus a script that talks to the host and puts each
// report the tool returns into the page.
export function renderAppShell() {
  const template = readFileSync(TEMPLATE_PATH, 'utf8');
  const loading = `<div class="app-loading" id="app-loading"><span class="spinner" aria-hidden="true"></span><p>Loading the review report…</p></div>`;
  return fillTemplate(template, {
    PAGE_TITLE: 'AI PR Review',
    GENERATED_AT: '',
    GENERATED_ISO: '',
    HEADER: loading,
    SUMMARY: '',
    REVIEWS: '',
    DATA_JSON: '',
    SIZE: 'm',
    THEME: 'light',
    APP_SCRIPT: `<script>\n${readFileSync(APP_BRIDGE_PATH, 'utf8')}\n</script>`,
  });
}
