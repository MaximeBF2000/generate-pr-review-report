# generate-pr-review-report - CLI tool for review agents

[![npm](https://img.shields.io/npm/v/generate-pr-review-report.svg)](https://www.npmjs.com/package/generate-pr-review-report)
[![license](https://img.shields.io/npm/l/generate-pr-review-report.svg)](LICENSE)

CLI tool for Code Review agents to render their report in a clean HTML template.

The CLI turns a structured JSON produced by an AI code-review agent into a **single, self-contained HTML file** (no external assets, no network calls). Node ≥ 20. The CLI itself loads no dependencies; only the optional MCP server uses the official MCP SDK.
Easy review for the human that reads the report.

It can also run as an **MCP server with an MCP App**, so the report opens right inside the agent's conversation (see [Show the report inside your agent](#show-the-report-inside-your-agent-mcp-app)).

![Example review report](./ai-pr-review-preview.png)

## Install

Run it without installing (always uses the latest version):

```bash
npx generate-pr-review-report -i review.json -o ./review-report-pr-482.html
```

Or install the command globally:

```bash
npm install -g generate-pr-review-report
```

Or install straight from GitHub (no npm registry needed):

```bash
npm install -g github:MaximeBF2000/generate-pr-review-report
```

## Usage

```bash
generate-pr-review-report -i '{...}' -o ./review-report-pr-482.html
generate-pr-review-report --input review.json --output ./review-report-pr-482.html
cat review.json | generate-pr-review-report -i -
generate-pr-review-report -i review.json --dark --size L
```

| Flag                           | Description                                                                                                                |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `-i, --input`                  | Inline JSON string, path to a `.json` file, or `-` for stdin. **Required.**                                                |
| `-o, --output`                 | Output path. Defaults to `./review-report-pr-<key>.html` (or `./review-report-<branch>.html`). Parent folders are created. |
| `-s, --size`                   | Default text size: `S`, `M` (default) or `L`.                                                                              |
| `-d, --dark`                   | Open the report in dark mode (light is the default).                                                                       |
| `-h, --help` / `-v, --version` |                                                                                                                            |

`--size` and `--dark` only set how the report opens. Readers can switch the text size (S / M / L) and the theme from the top-right of the page. The size only changes text, not the page width. Each change is written to the URL (`?size=l&theme=dark`), so a bookmark or shared link opens the same view, and those URL values override the generated defaults.

### Full-file viewer

The CLI reads the file of every feedback and embeds it in the report (each file once), so the agent never has to repeat code in its JSON. It looks for each file in this order:

1. The feedback's `absolute_path`. This is exact, and works for reviews that span several repositories.
2. The relative `file`, searched in the git repository of the current directory, then the current directory, each followed by its parent folder (for sibling repositories, like `other-repo/package.json`).

The CLI prints `✓ Code context loaded for 6/6 files` (or a warning per missing file) on stderr. In the report, every feedback shows a code block:

- **With a `suggestion`:** the suggested change as a diff ("Code suggestion").
- **Without one:** the commented lines, highlighted, with 3 lines of context above and below, read from the file ("Code"). The agent doesn't have to copy any code for this.

Next to the block's title, **View full file** (or a click on the file path) opens the whole file in its place. The commented lines are highlighted and the suggestion is shown in place as a diff.

The CLI also finds each `suggestion` in the real file (ignoring indentation), so diff line numbers are exact even if `lineStart` is a little off. Files that are missing, binary or larger than 1 MB are skipped with a warning on stderr. The report still generates, and those findings show a disabled "File not available" button.

On success the absolute output path is printed to **stdout** (easy for an agent to capture). On invalid input it exits `1` and lists _every_ problem on stderr, e.g. `feedbacks[2].severity: expected one of "must_fix", "should_consider", "nit"` — so the agent can fix everything in one retry.

## Show the report inside your agent (MCP App)

`generate-pr-review-report mcp` starts an [MCP](https://modelcontextprotocol.io) server over stdio. Its tool returns the report as an [MCP App](https://modelcontextprotocol.io/docs/extensions/apps), so hosts that support MCP Apps show the interactive report in the conversation instead of a file path.

Add it to your agent:

```bash
claude mcp add pr-review-report -- npx -y generate-pr-review-report mcp
```

```bash
codex mcp add pr-review-report -- npx -y generate-pr-review-report mcp
```

Or in any host's JSON config (Claude Desktop, VS Code, …):

```json
{
  "mcpServers": {
    "pr-review-report": { "command": "npx", "args": ["-y", "generate-pr-review-report", "mcp"] }
  }
}
```

**Tool `show_pr_review_report`**, called by the agent at the end of a review:

| Argument | Description |
| --- | --- |
| `review` | The review object ([JSON schema](#json-schema)). Give this or `path`. |
| `path` | Absolute path to a review `.json` file, or to an `.html` report already made by the CLI. |
| `output` | Where to save the HTML. Defaults to the system temp folder (`<tmp>/generate-pr-review-report/`). |
| `size` / `dark` | Same as `--size` / `--dark`. In the app, the host's light/dark theme wins. |

- The report is always saved as an HTML file, and the tool's text result gives its path. Hosts without MCP Apps support (terminal agents, for example) still get a usable report.
- The HTML goes to the app in the result's `_meta`, so it never fills the model's context. The model only sees a one-line summary (comment counts and path). If a host drops `_meta`, the app fetches the HTML through `get_pr_review_report_html`, a tool only the app can call.
- Invalid reviews return every error at once, as the CLI does.
- Inside the host, the report works as it does in a browser (filters, file viewer, editable comments, copy buttons). Links open through the host. Two extra buttons appear in the top bar: **Download** (saves the HTML through the host) and **Full screen**, when the host offers them.

## Using it from an AI agent skill

Add a step like this to your review skill, after the agent has built its review:

> Write the review as JSON (schema below) to a temporary file, then run
> `npx -y generate-pr-review-report -i <tmp>.json -o ./review-report-pr-<number>.html`.
> If the command exits with code 1, fix every error it lists and run it again.
> Return the path it prints.

Prefer a temp file (or stdin) over inline `-i '{...}'`. Markdown in summaries often contains `'` and `` ` `` characters that break shell quoting.

## JSON schema

```jsonc
{
  "key": 482, // PR number (or any string id) — optional
  "branch": "feature/my-feature", // optional
  "url": "https://github.com/u/r/pull/482", // optional — enables the "View PR" button
  "title": "Add user notification preferences", // required — the PR title
  "summary": "Markdown…", // required — overview, architecture, context
  "author": "jdoe", // optional (leading @ is stripped)
  "numberOfFilesChanged": 4, // optional
  "numberOfLinesAdded": 342, // optional
  "numberOfLinesDeleted": 56, // optional
  "feedbacks": [
    // required — use [] for a clean PR ("Ready to merge" view)
    {
      "file": "src/services/notification.service.ts", // required
      "absolute_path": "/abs/path/to/repo/src/services/notification.service.ts", // optional — where the CLI reads the file from
      "severity": "must_fix", // required: must_fix | should_consider | nit
      "lineStart": 42, // optional
      "lineEnd": 47, // optional (defaults to lineStart)
      "title": "Handle potential null user", // optional — short headline; derived from `comment` if omitted
      "text": "Markdown explanation for you (can be verbose)", // required
      "comment": "Concise comment to post on the PR", // required — editable + copyable in the report
      "suggestion": " context\n-removed\n+added" // optional — unified-diff lines; located in the real file for exact line numbers
    }
  ]
}
```

`title` and `suggestion` are optional additions to the original brief: they power the finding headline and the "Code suggestion" diff block.

Severity aliases like `must-fix`, `Must fix`, `consider`, `nitpick` are accepted and normalized. Findings are shown ordered by severity.

## The generated report

- Header with PR number, title, author, size, branch and a link to the PR
- Summary rendered from Markdown, with stats pills (files, +/−, comments per severity)
- Review comments filterable by severity, collapsible, each with a copy-path button, an **editable** suggested comment with a copy button, and an optional diff
- Checkboxes choose which comments go into **Copy review** (copies the whole review as Markdown, including your edits)
- Empty state "No feedback — PR looks good to go" when `feedbacks` is `[]`
- Clicking a file path opens the full file, with the commented lines highlighted and the suggestion shown as a diff (the CLI reads the file, see above)
- S / M / L text size switch and a light / dark theme toggle in the top bar, kept in the URL
- All agent-provided text is HTML-escaped; Markdown links only allow http(s)/mailto/relative URLs

## Project layout

```
bin/generate-pr-review-report.js   CLI (argument parsing, I/O)
src/validate.js                    schema validation + normalization
src/markdown.js                    tiny safe Markdown renderer
src/render.js                      builds the HTML fragments, fills the template
templates/report.html              page shell: CSS + interaction script
templates/mcp-app.js               MCP Apps bridge, inlined into the page when shown in an agent host
src/build.js                       validate + read files + render (shared by the CLI and the MCP server)
src/mcp-server.js                  MCP server: report tool and the ui:// app resource
src/files.js                       reads repository files for the file viewer
examples/                          sample inputs (with findings / clean PR) + sample-repo/ for the file viewer
```

## Development

```bash
git clone https://github.com/MaximeBF2000/generate-pr-review-report.git
cd generate-pr-review-report
npm link          # use your local checkout as the global command
npm run example   # builds out/review-report-pr-482.html and out/review-report-pr-728.html
npm test
```

### Releasing a new version

```bash
npm version patch   # or minor / major — bumps package.json and creates a git tag
git push --follow-tags
npm publish         # runs the tests first (prepublishOnly)
```

## License

MIT
