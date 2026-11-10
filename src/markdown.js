// Minimal, dependency-free Markdown → HTML renderer.
// All text is HTML-escaped before inline formatting is applied, so model output
// can never inject markup or scripts into the report.
//
// Supported: headings, paragraphs, bullet / numbered lists (one level of nesting),
// blockquotes, fenced code blocks, horizontal rules, inline code, bold, italic,
// strikethrough and links (http(s), mailto, relative and #anchors only).

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

const SAFE_URL = /^(https?:\/\/|mailto:|#|\/|\.{1,2}\/|[\w-]+(\/|\.|$))/i;

function renderInline(text) {
  // Pull code spans out first so their content is not formatted.
  const codes = [];
  let s = text.replace(/`([^`\n]+)`/g, (_, code) => {
    codes.push(`<code>${escapeHtml(code)}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  s = escapeHtml(s);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, label, url) => {
    const raw = url.replace(/&amp;/g, '&');
    if (!SAFE_URL.test(raw) || /^\s*javascript:/i.test(raw)) return label;
    return `<a href="${escapeHtml(raw)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });
  s = s
    .replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_\n]+?)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\n]+?)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/(^|[^_\w])_([^_\n]+?)_(?!\w)/g, '$1<em>$2</em>')
    .replace(/~~([^~\n]+?)~~/g, '<del>$1</del>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[Number(i)]);
}

const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

function renderList(lines, start) {
  const first = lines[start].match(LIST_ITEM);
  const baseIndent = first[1].length;
  const ordered = /\d/.test(first[2]);
  const items = [];
  let i = start;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      // A blank line ends the list unless the next line continues it.
      const next = lines[i + 1];
      if (next && LIST_ITEM.test(next) && next.match(LIST_ITEM)[1].length >= baseIndent) { i++; continue; }
      break;
    }
    const m = line.match(LIST_ITEM);
    if (m && m[1].length === baseIndent) {
      items.push({ text: m[3], children: [] });
      i++;
    } else if (m && m[1].length > baseIndent && items.length) {
      const nested = renderList(lines, i);
      items[items.length - 1].children.push(nested.html);
      i = nested.end;
    } else if (!m && /^\s+\S/.test(line) && items.length) {
      items[items.length - 1].text += ' ' + line.trim();
      i++;
    } else {
      break;
    }
  }
  const tag = ordered ? 'ol' : 'ul';
  const html = `<${tag}>${items.map((it) => `<li>${renderInline(it.text)}${it.children.join('')}</li>`).join('')}</${tag}>`;
  return { html, end: i };
}

export function renderMarkdown(source) {
  if (source == null) return '';
  const lines = String(source).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    const fence = line.match(/^\s*(```|~~~)\s*([\w+-]*)/);
    if (fence) {
      const body = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++]);
      i++;
      const lang = fence[2] ? ` data-lang="${escapeHtml(fence[2])}"` : '';
      out.push(`<pre class="md-code"${lang}><code>${escapeHtml(body.join('\n'))}</code></pre>`);
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (heading) {
      // Report sections already use h1/h2, so summary headings start at h3.
      const level = Math.min(6, heading[1].length + 2);
      out.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      i++;
      continue;
    }

    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { out.push('<hr />'); i++; continue; }

    if (/^\s*>/.test(line)) {
      const quote = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push(`<blockquote>${renderMarkdown(quote.join('\n'))}</blockquote>`);
      continue;
    }

    if (LIST_ITEM.test(line)) {
      const list = renderList(lines, i);
      out.push(list.html);
      i = list.end;
      continue;
    }

    const para = [];
    while (
      i < lines.length && lines[i].trim() &&
      !/^\s*(```|~~~|#{1,6}\s|>)/.test(lines[i]) && !LIST_ITEM.test(lines[i])
    ) para.push(lines[i++].trim());
    out.push(`<p>${para.map(renderInline).join(' ')}</p>`);
  }
  return out.join('\n');
}
