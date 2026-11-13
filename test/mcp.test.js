import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { createMcpServer, HTML_META_KEY } from '../src/mcp-server.js';

const example = (name) => fileURLToPath(new URL(`../examples/${name}`, import.meta.url));

async function connect() {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createMcpServer().connect(serverSide);
  const client = new Client({ name: 'test', version: '1' });
  await client.connect(clientSide);
  return client;
}

test('MCP: the report tool points at the app resource, the HTML tool is app-only', async () => {
  const client = await connect();
  const { tools } = await client.listTools();
  const show = tools.find((t) => t.name === 'show_pr_review_report');
  const get = tools.find((t) => t.name === 'get_pr_review_report_html');
  assert.equal(show._meta.ui.resourceUri, 'ui://generate-pr-review-report/report.html');
  assert.deepEqual(get._meta.ui.visibility, ['app']);

  const { contents } = await client.readResource({ uri: show._meta.ui.resourceUri });
  assert.equal(contents[0].mimeType, RESOURCE_MIME_TYPE);
  assert.match(contents[0].text, /ui\/initialize/);
  assert.match(contents[0].text, /id="review-data"><\/script>/);
  await client.close();
});

test('MCP: renders a review, keeps the HTML out of the model-visible content, saves it', async () => {
  const client = await connect();
  const output = join(mkdtempSync(join(tmpdir(), 'prr-mcp-')), 'r.html');
  const review = JSON.parse(readFileSync(example('pr-482.json'), 'utf8'));
  review.repository_root = example('sample-repo');
  const res = await client.callTool({ name: 'show_pr_review_report', arguments: { review, output } });
  assert.ok(!res.isError);
  assert.match(res.content[0].text, /4 comments: 1 must fix/);
  assert.ok(!res.content[0].text.includes('<html'));
  assert.equal(res.structuredContent.path, output);
  const html = res._meta[HTML_META_KEY];
  assert.equal(html, readFileSync(output, 'utf8'));
  assert.match(html, /data-action="view-file"/);

  const again = await client.callTool({ name: 'get_pr_review_report_html', arguments: { reportId: res.structuredContent.reportId } });
  assert.equal(again._meta[HTML_META_KEY], html);
  const refused = await client.callTool({ name: 'get_pr_review_report_html', arguments: { reportId: '/etc/passwd' } });
  assert.ok(refused.isError);
  await client.close();
});

test('MCP: lists every validation error, and accepts a path to JSON or HTML', async () => {
  const client = await connect();
  const dir = mkdtempSync(join(tmpdir(), 'prr-mcp-'));
  const bad = await client.callTool({ name: 'show_pr_review_report', arguments: { review: { title: 'T', summary: 'S', feedbacks: [{ file: 'a', severity: 'huge', text: 't', comment: 'c' }] }, output: join(dir, 'x.html') } });
  assert.ok(bad.isError);
  assert.match(bad.content[0].text, /feedbacks\[0\]\.severity/);

  const fromJson = await client.callTool({ name: 'show_pr_review_report', arguments: { path: example('pr-728-clean.json'), output: join(dir, 'clean.html') } });
  assert.ok(!fromJson.isError);
  assert.match(fromJson.content[0].text, /no comments/);

  const existing = join(dir, 'existing.html');
  writeFileSync(existing, fromJson._meta[HTML_META_KEY]);
  const fromHtml = await client.callTool({ name: 'show_pr_review_report', arguments: { path: existing } });
  assert.equal(fromHtml.structuredContent.path, existing);
  assert.equal(fromHtml._meta[HTML_META_KEY], fromJson._meta[HTML_META_KEY]);

  const both = await client.callTool({ name: 'show_pr_review_report', arguments: {} });
  assert.ok(both.isError);
  await client.close();
});
