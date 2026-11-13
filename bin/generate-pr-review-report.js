#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { buildReport, defaultReportName } from '../src/build.js';
import { ValidationError } from '../src/validate.js';

const USAGE = `Usage: generate-pr-review-report -i <json|file|-> [-o <file.html>] [--size S|M|L] [--dark]
       generate-pr-review-report mcp

Generate a static, self-contained HTML report from an AI PR review JSON payload.
"mcp" starts an MCP server (stdio) whose tool shows the report inside agent
hosts that support MCP Apps (Claude, Claude Desktop, VS Code, ...).

Options:
  -i, --input <value>   Review JSON. Accepts an inline JSON string, a path to a
                        .json file, or "-" to read from stdin.
  -o, --output <file>   Output HTML path. Defaults to ./review-report-pr-<key>.html
                        (or ./review-report-<branch>.html when there is no key).
  -s, --size <S|M|L>    Default text size of the report (default: M).
                        Viewers can still switch it in the page.
  -d, --dark            Open the report in dark mode by default
                        (viewers can still switch to light).
  -h, --help            Show this help.
  -v, --version         Show the version.

Examples:
  generate-pr-review-report -i '{"key":482,"title":"...","summary":"...","feedbacks":[]}' -o ./review-report-pr-482.html
  generate-pr-review-report --input review.json --output ./out/report.html --size L --dark
  cat review.json | generate-pr-review-report -i -`;

function fail(message, code = 1) {
  process.stderr.write(`error: ${message}\n`);
  process.exit(code);
}

function readInput(value) {
  if (value === '-') return readFileSync(0, 'utf8');
  const trimmed = value.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return trimmed;
  const path = resolve(value);
  if (!existsSync(path)) fail(`--input is neither JSON nor an existing file: ${value}`);
  return readFileSync(path, 'utf8');
}

if (process.argv[2] === 'mcp') {
  // Loaded only here, so the plain CLI never needs the MCP SDK.
  const { startMcpServer } = await import('../src/mcp-server.js');
  await startMcpServer();
} else {
  runCli();
}

function runCli() {
  let args;
  try {
    args = parseArgs({
      options: {
        input: { type: 'string', short: 'i' },
        output: { type: 'string', short: 'o' },
        size: { type: 'string', short: 's', default: 'M' },
        dark: { type: 'boolean', short: 'd', default: false },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
      },
      allowPositionals: false,
    }).values;
  } catch (err) {
    fail(`${err.message}\n\n${USAGE}`, 2);
  }

  if (args.help) { process.stdout.write(`${USAGE}\n`); process.exit(0); }
  if (args.version) {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    process.stdout.write(`${pkg.version}\n`);
    process.exit(0);
  }
  if (args.input == null) fail(`missing required --input\n\n${USAGE}`, 2);
  const size = args.size.trim().toLowerCase();
  if (!['s', 'm', 'l'].includes(size)) fail(`--size must be S, M or L (got "${args.size}")`, 2);

  let parsed;
  try {
    parsed = JSON.parse(readInput(args.input));
  } catch (err) {
    fail(`could not parse input JSON: ${err.message}`);
  }

  let report;
  try {
    report = buildReport(parsed, { size, theme: args.dark ? 'dark' : 'light' });
  } catch (err) {
    if (err instanceof ValidationError) fail(err.message);
    throw err;
  }
  for (const warning of report.warnings) process.stderr.write(`warning: ${warning}\n`);

  const outputPath = resolve(args.output ?? defaultReportName(report.review));
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, report.html, 'utf8');

  const n = report.review.feedbacks.length;
  process.stdout.write(`${outputPath}\n`);
  process.stderr.write(`✓ Report generated with ${n} comment${n === 1 ? '' : 's'}\n`);
  const { loaded, total } = report.fileStats;
  if (total) process.stderr.write(`${loaded === total ? '✓' : '!'} Code context loaded for ${loaded}/${total} file${total === 1 ? '' : 's'}\n`);
}
