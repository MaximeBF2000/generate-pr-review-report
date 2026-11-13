import { loadRepositoryFiles } from './files.js';
import { renderReport } from './render.js';
import { validateReview } from './validate.js';

// Validates a parsed review, reads the files its findings point at (when it
// has repository_root) and renders the HTML report. Throws ValidationError.
export function buildReport(parsed, { size = 'm', theme = 'light' } = {}) {
  const review = validateReview(parsed);
  // Full file contents for the in-report file viewer, read here so the agent
  // never has to put whole files in its JSON.
  let files = {};
  let warnings = [];
  if (review.repositoryRoot) {
    const loaded = loadRepositoryFiles(review.repositoryRoot, review.feedbacks.map((f) => f.file));
    files = loaded.files;
    warnings = loaded.warnings;
  }
  return { review, warnings, html: renderReport(review, { size, theme, files }) };
}

export function defaultReportName(review) {
  const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  if (review.key != null && review.key !== '') return `review-report-pr-${slug(review.key)}.html`;
  if (review.branch) return `review-report-${slug(review.branch)}.html`;
  return 'review-report.html';
}
