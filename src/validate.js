// Validates and normalizes the review JSON produced by the AI agent.
// Errors are collected (not thrown one by one) so the agent can fix
// every problem in a single retry.

export const SEVERITIES = ['must_fix', 'should_consider', 'nit'];

const SEVERITY_ALIASES = {
  must_fix: 'must_fix', mustfix: 'must_fix', blocker: 'must_fix', critical: 'must_fix',
  should_consider: 'should_consider', consider: 'should_consider', suggestion: 'should_consider',
  nit: 'nit', nitpick: 'nit',
};

export class ValidationError extends Error {
  constructor(errors) {
    super(`Invalid review JSON:\n${errors.map((e) => `  - ${e}`).join('\n')}`);
    this.errors = errors;
  }
}

const isInt = (v) => Number.isInteger(v) && v >= 0;
const isNonEmptyString = (v) => typeof v === 'string' && v.trim() !== '';

export function validateReview(input) {
  const errors = [];
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new ValidationError(['root: expected a JSON object']);
  }

  const optionalString = (field) => {
    const v = input[field];
    if (v == null || v === '') return undefined;
    if (typeof v !== 'string') { errors.push(`${field}: expected a string`); return undefined; }
    return v.trim();
  };
  const optionalInt = (field) => {
    const v = input[field];
    if (v == null) return undefined;
    if (!isInt(v)) { errors.push(`${field}: expected a non-negative integer`); return undefined; }
    return v;
  };

  let key = input.key;
  if (key != null && !(typeof key === 'string' || isInt(key))) {
    errors.push('key: expected a PR number or string');
    key = undefined;
  }

  if (!isNonEmptyString(input.title)) errors.push('title: required non-empty string');
  if (typeof input.summary !== 'string') errors.push('summary: required Markdown string');

  const url = optionalString('url');
  if (url && !/^https?:\/\//i.test(url)) errors.push('url: must start with http:// or https://');

  const review = {
    key: key ?? undefined,
    branch: optionalString('branch'),
    url,
    title: isNonEmptyString(input.title) ? input.title.trim() : '',
    summary: typeof input.summary === 'string' ? input.summary : '',
    author: optionalString('author')?.replace(/^@/, ''),
    numberOfFilesChanged: optionalInt('numberOfFilesChanged'),
    numberOfLinesAdded: optionalInt('numberOfLinesAdded'),
    numberOfLinesDeleted: optionalInt('numberOfLinesDeleted'),
    feedbacks: [],
  };

  if (!Array.isArray(input.feedbacks)) {
    errors.push('feedbacks: required array (use [] when there is no feedback)');
  } else {
    input.feedbacks.forEach((fb, index) => {
      const at = `feedbacks[${index}]`;
      if (fb === null || typeof fb !== 'object' || Array.isArray(fb)) {
        errors.push(`${at}: expected an object`);
        return;
      }
      const sevKey = typeof fb.severity === 'string' ? fb.severity.trim().toLowerCase().replace(/[\s-]+/g, '_') : '';
      const severity = SEVERITY_ALIASES[sevKey] ?? SEVERITY_ALIASES[sevKey.replace(/_/g, '')];
      if (!severity) errors.push(`${at}.severity: expected one of ${SEVERITIES.map((s) => `"${s}"`).join(', ')}, got ${JSON.stringify(fb.severity)}`);
      if (!isNonEmptyString(fb.file)) errors.push(`${at}.file: required non-empty string`);
      if (!isNonEmptyString(fb.text)) errors.push(`${at}.text: required Markdown string`);
      if (!isNonEmptyString(fb.comment)) errors.push(`${at}.comment: required string`);

      let lineStart = fb.lineStart;
      let lineEnd = fb.lineEnd;
      if (lineStart != null && !isInt(lineStart)) { errors.push(`${at}.lineStart: expected a non-negative integer`); lineStart = undefined; }
      if (lineEnd != null && !isInt(lineEnd)) { errors.push(`${at}.lineEnd: expected a non-negative integer`); lineEnd = undefined; }
      if (lineStart == null && lineEnd != null) lineStart = lineEnd;
      if (lineEnd == null && lineStart != null) lineEnd = lineStart;
      if (lineStart != null && lineEnd < lineStart) errors.push(`${at}.lineEnd: must be >= lineStart`);

      if (fb.title != null && typeof fb.title !== 'string') errors.push(`${at}.title: expected a string`);
      if (fb.suggestion != null && typeof fb.suggestion !== 'string') errors.push(`${at}.suggestion: expected a diff string`);
      const absField = fb.absolute_path ?? fb.absolutePath;
      let absolutePath;
      if (absField != null && absField !== '') {
        if (typeof absField !== 'string' || !(absField.startsWith('/') || /^[A-Za-z]:[\\/]/.test(absField))) errors.push(`${at}.absolute_path: expected an absolute path`);
        else absolutePath = absField.trim();
      }

      review.feedbacks.push({
        id: index + 1,
        severity,
        file: typeof fb.file === 'string' ? fb.file.trim().replace(/^\.\//, '') : '',
        absolutePath,
        lineStart,
        lineEnd,
        title: typeof fb.title === 'string' && fb.title.trim() ? fb.title.trim() : deriveTitle(fb.comment ?? fb.text),
        text: typeof fb.text === 'string' ? fb.text : '',
        comment: typeof fb.comment === 'string' ? fb.comment.trim() : '',
        suggestion: typeof fb.suggestion === 'string' && fb.suggestion.trim() ? fb.suggestion.replace(/\s+$/, '') : undefined,
      });
    });
  }

  if (errors.length) throw new ValidationError(errors);

  // Most important findings first, keeping the agent's order within a severity.
  review.feedbacks.sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) || a.id - b.id);
  return review;
}

// Fallback when the agent gives no explicit title: first sentence of the
// comment, stripped of Markdown and trimmed to a readable length.
function deriveTitle(source) {
  if (typeof source !== 'string') return 'Review comment';
  const plain = source.replace(/[`*_~#>[\]]/g, '').replace(/\(https?:[^)]*\)/g, '').replace(/\s+/g, ' ').trim();
  const sentence = plain.split(/(?<=[.!?])\s/)[0].replace(/[.!?]$/, '');
  if (!sentence) return 'Review comment';
  return sentence.length > 70 ? `${sentence.slice(0, 67).replace(/\s+\S*$/, '')}…` : sentence;
}
