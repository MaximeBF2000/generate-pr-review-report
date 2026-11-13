// MCP server with an MCP App (https://modelcontextprotocol.io/docs/extensions/apps):
// the agent calls `show_pr_review_report` with its review, and hosts that
// support MCP Apps show the interactive report right in the conversation.
// Hosts without MCP Apps still get the report saved to an HTML file.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { RESOURCE_MIME_TYPE, registerAppResource, registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import { z } from 'zod';
import { buildReport, defaultReportName } from './build.js';
import { renderAppShell } from './render.js';

const RESOURCE_URI = 'ui://generate-pr-review-report/report.html';
// Key of the result's _meta that carries the report HTML to the app. It is
// kept out of `content`/`structuredContent` so the model never reads it.
export const HTML_META_KEY = 'generate-pr-review-report/html';
const DEFAULT_DIR = join(tmpdir(), 'generate-pr-review-report');

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const feedbackSchema = z.object({
  file: z.string().describe('Path relative to the repository root.'),
  severity: z.string().describe('must_fix, should_consider or nit.'),
  lineStart: z.number().int().optional().describe('First commented line, in the new version of the file.'),
  lineEnd: z.number().int().optional().describe('Last commented line (defaults to lineStart).'),
  title: z.string().optional().describe('Short headline of 3–7 words.'),
  text: z.string().describe('Markdown explanation for the reviewer; can be detailed.'),
  comment: z.string().describe('Short, actionable comment ready to post on the PR.'),
  suggestion: z.string().optional().describe('Diff lines, each prefixed with "+", "-" or a space (context). Include ~3 lines of context above and below.'),
}).loose();

const reviewSchema = z.object({
  key: z.union([z.number(), z.string()]).optional().describe('PR number or another id.'),
  branch: z.string().optional(),
  url: z.string().optional().describe('Link to the PR.'),
  repository_root: z.string().optional().describe('Absolute path of the local checkout of the PR branch. The server reads the commented files from there for the full-file viewer; never copy file contents into the review.'),
  title: z.string().describe('The PR title.'),
  summary: z.string().describe('Markdown: what the PR does, architecture, context.'),
  author: z.string().optional(),
  numberOfFilesChanged: z.number().int().optional(),
  numberOfLinesAdded: z.number().int().optional(),
  numberOfLinesDeleted: z.number().int().optional(),
  feedbacks: z.array(feedbackSchema).describe('Review comments. [] means the PR is clean.'),
}).loose();

const inputSchema = z.object({
  review: reviewSchema.optional().describe('The review to render. Give this or `path`.'),
  path: z.string().optional().describe('Absolute path to a review .json file, or to a report .html already made by the generate-pr-review-report CLI. Give this or `review`.'),
  output: z.string().optional().describe('Where to save the HTML report. Defaults to a file in the system temp folder.'),
  size: z.enum(['S', 'M', 'L']).optional().describe('Default text size (default M).'),
  dark: z.boolean().optional().describe('Open in dark mode when the host does not set a theme.'),
});

// Reports made by this server, so the app can fetch one again by id.
const reports = new Map();

const errorResult = (text) => ({ isError: true, content: [{ type: 'text', text }] });

function summarize(review) {
  const counts = { must_fix: 0, should_consider: 0, nit: 0 };
  for (const f of review.feedbacks) counts[f.severity]++;
  const n = review.feedbacks.length;
  return n
    ? `${n} comment${n === 1 ? '' : 's'}: ${counts.must_fix} must fix, ${counts.should_consider} to consider, ${counts.nit} nit`
    : 'no comments (ready to merge)';
}

// Returns { html, fileName, title, details } or throws an Error whose
// message is meant for the agent.
function makeReport({ review, path, size = 'M', dark = false }) {
  const options = { size: size.toLowerCase(), theme: dark ? 'dark' : 'light' };
  if ((review == null) === (path == null)) throw new Error('Give exactly one of `review` or `path`.');
  if (path != null) {
    const file = resolve(path);
    if (!existsSync(file)) throw new Error(`File not found: ${file}`);
    const text = readFileSync(file, 'utf8');
    if (extname(file).toLowerCase() === '.html' || /^\s*<(!doctype|html)/i.test(text)) {
      if (!text.includes('id="review-data"')) throw new Error(`${file} is not a report made by generate-pr-review-report.`);
      const title = (text.match(/<title>([^<]*)<\/title>/)?.[1] ?? basename(file)).replace(/^AI PR Review — /, "");
      return { html: text, fileName: basename(file), title, details: 'existing report', warnings: [], existing: true };
    }
    try { review = JSON.parse(text); } catch (err) { throw new Error(`Could not parse ${file} as JSON: ${err.message}`); }
  }
  const built = buildReport(review, options);
  return {
    html: built.html,
    fileName: defaultReportName(built.review),
    title: built.review.title,
    details: summarize(built.review),
    warnings: built.warnings,
  };
}

export function createMcpServer() {
  const server = new McpServer({ name: 'generate-pr-review-report', version: pkg.version });

  registerAppTool(server, 'show_pr_review_report', {
    title: 'Show PR review report',
    description: [
      'Shows a finished pull request review as an interactive report (summary, review comments by severity, editable PR comments, code suggestions, full-file viewer) inside the conversation, and saves it as a standalone HTML file.',
      'Call it at the end of a code review with the review in `review`, or with `path` pointing to a review JSON file or an HTML report already generated by the CLI.',
      'If the review is invalid, the result lists every problem: fix them all and call again.',
    ].join(' '),
    inputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    _meta: { ui: { resourceUri: RESOURCE_URI } },
  }, async (args) => {
    let report;
    try {
      report = makeReport(args);
    } catch (err) {
      return errorResult(err.message);
    }
    // Always keep a copy on disk: hosts without MCP Apps can still open it.
    let savedTo;
    if (report.existing && !args.output) {
      savedTo = resolve(args.path);
    } else {
      savedTo = resolve(args.output ?? join(DEFAULT_DIR, report.fileName));
      try {
        mkdirSync(dirname(savedTo), { recursive: true });
        writeFileSync(savedTo, report.html, 'utf8');
      } catch (err) {
        return errorResult(`Could not write the report to ${savedTo}: ${err.message}`);
      }
    }
    const reportId = savedTo;
    reports.set(reportId, report.html);
    const lines = [`Review report for "${report.title}" (${report.details}).`, `Saved to ${savedTo}`];
    for (const w of report.warnings) lines.push(`warning: ${w}`);
    return {
      content: [{ type: 'text', text: lines.join('\n') }],
      structuredContent: { reportId, path: savedTo, fileName: basename(savedTo), title: report.title },
      _meta: { [HTML_META_KEY]: report.html },
    };
  });

  // Called by the app only (hidden from the model) when the host did not pass
  // the HTML through the tool result's _meta.
  registerAppTool(server, 'get_pr_review_report_html', {
    title: 'Get PR review report HTML',
    description: 'Returns the HTML of a report made by show_pr_review_report. Used by the report view.',
    inputSchema: z.object({ reportId: z.string() }),
    annotations: { readOnlyHint: true },
    _meta: { ui: { resourceUri: RESOURCE_URI, visibility: ['app'] } },
  }, async ({ reportId }) => {
    let html = reports.get(reportId);
    // After a restart, only reports saved in the default folder are re-read.
    if (html == null && resolve(reportId).startsWith(DEFAULT_DIR + '/') && existsSync(reportId)) html = readFileSync(reportId, 'utf8');
    if (html == null) return errorResult(`Unknown report: ${reportId}`);
    return { content: [{ type: 'text', text: 'Report HTML is in _meta.' }], _meta: { [HTML_META_KEY]: html } };
  });

  registerAppResource(server, 'PR review report', RESOURCE_URI, {
    description: 'Interactive view of an AI pull request review.',
    mimeType: RESOURCE_MIME_TYPE,
  }, async () => ({
    contents: [{
      uri: RESOURCE_URI,
      mimeType: RESOURCE_MIME_TYPE,
      text: renderAppShell(),
      // Self-contained page: no network access needed. Clipboard is used by
      // the copy buttons.
      _meta: { ui: { prefersBorder: true, permissions: { clipboardWrite: {} } } },
    }],
  }));

  return server;
}

export async function startMcpServer() {
  const server = createMcpServer();
  await server.connect(new StdioServerTransport());
}
