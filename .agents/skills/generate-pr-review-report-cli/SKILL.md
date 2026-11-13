---
name: generate-pr-review-report-cli
description: Renders a finished pull request review as a self-contained HTML report using the generate-pr-review-report CLI. Use at the end of a code review, once the summary and feedback are written, when the review should be delivered as an HTML file instead of plain text.
---

# generate-pr-review-report CLI

`generate-pr-review-report` turns a review JSON file into one standalone HTML report: a PR header, a Markdown summary, and the review comments, each with a severity, location, explanation, editable comment and optional diff.

## If the `show_pr_review_report` MCP tool is available

Prefer it over the CLI: the host shows the report inside the conversation. Call it with the review object (format below) in `review`. If the result is an error, fix every problem it lists and call it again. Then tell the user where the report was saved (the path in the result).

## Usage

1. Write the review JSON to a temporary file. Do not pass inline JSON: Markdown quotes and backticks break shell quoting.
2. Run:
   ```bash
   generate-pr-review-report -i /tmp/review-482.json -o ./review-report-pr-482.html
   ```
3. On success (exit 0) it prints the absolute report path on stdout. Give that path to the user.
4. On exit 1 it lists every invalid field on stderr (for example `feedbacks[2].severity: expected one of ...`). Fix all of them in the JSON and run it again.

`-o` is optional and defaults to `./review-report-pr-<key>.html`. `-i -` reads JSON from stdin.

## JSON format

```json
{
  "key": 482,
  "branch": "feature/my-feature",
  "url": "https://github.com/owner/repo/pull/482",
  "title": "Add user notification preferences",
  "summary": "Markdown: what the PR does, architecture, context.",
  "author": "jdoe",
  "numberOfFilesChanged": 4,
  "numberOfLinesAdded": 342,
  "numberOfLinesDeleted": 56,
  "feedbacks": [
    {
      "file": "src/services/notification.service.ts", // relative to the repo root
      "absolute_path": "/abs/path/to/repo/src/services/notification.service.ts",
      "severity": "must_fix",
      "lineStart": 42,
      "lineEnd": 47,
      "title": "Handle potential null user",
      "text": "Markdown explanation for the reviewer; can be detailed.",
      "comment": "Short, actionable comment ready to post on the PR.",
      "suggestion": " const user = await repo.findById(id);\n-return user.prefs;\n+if (!user) throw new NotFoundError(id);\n+return user.prefs;"
    }
  ]
}
```

- **Required:** `title` (the PR title), `summary`, `feedbacks`. Each feedback needs `file`, `severity`, `text` and `comment`.
- **`severity`:** `must_fix`, `should_consider` or `nit`.
- **`feedbacks: []`** means a clean PR. The report then shows "No feedback — PR looks good to go".
- **`absolute_path`:** the file's absolute path on this machine, in the checkout of the PR branch. The CLI reads it to show the code and the full file, so never copy file contents into the JSON.
- **Paths:** `file` is relative to the repo root. `lineStart`/`lineEnd` are line numbers in the new version of the file.
- **`title` (in a feedback):** a short headline of about 3–7 words. If it's left out, the first sentence of `comment` is used.
- **`suggestion`:** optional diff lines. Prefix each with `+` (added), `-` (removed) or a space (context). They're numbered from `lineStart`. Always a 3 lines of the file's code context above and below the change.
- **Other fields:** leave out any you don't know rather than guessing. That includes `key`, `url`, `branch`, `author` and the counts.

## If the command is not installed

Check for it with `command -v generate-pr-review-report`. If it's missing, install it from GitHub. This needs Node.js 18 or later:

```bash
npm i -g github:MaximeBF2000/generate-pr-review-report
```

If a global install isn't allowed, run it without installing:

```bash
npx -y github:MaximeBF2000/generate-pr-review-report -i /tmp/review-482.json -o ./review-report-pr-482.html
```
