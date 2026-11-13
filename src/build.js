import { loadReviewFiles } from './files.js';
import { renderReport } from './render.js';
import { validateReview } from './validate.js';

// Validates a parsed review, reads the files its findings point at and
// renders the HTML report. Throws ValidationError.
//
// Files are read from each feedback's absolute_path (with a search fallback,
// see files.js), so every finding gets its code context and full-file viewer
// without the agent having to put any code in its JSON.
export function buildReport(parsed, { size = 'm', theme = 'light', cwd = process.cwd() } = {}) {
  const review = validateReview(parsed);
  const entries = review.feedbacks.map((f) => ({ file: f.file, absolutePath: f.absolutePath }));
  const { files, warnings } = loadReviewFiles(entries, { cwd });
  const fileStats = { loaded: Object.keys(files).length, total: new Set(entries.map((e) => e.file)).size };
  return { review, warnings, fileStats, html: renderReport(review, { size, theme, files }) };
}

export function defaultReportName(review) {
  const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  if (review.key != null && review.key !== '') return `review-report-pr-${slug(review.key)}.html`;
  if (review.branch) return `review-report-${slug(review.branch)}.html`;
  return 'review-report.html';
}
