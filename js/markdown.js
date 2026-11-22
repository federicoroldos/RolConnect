// Small, safe markdown renderer. All text is HTML-escaped; only http(s)/mailto links survive.

export const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function safeUrl(u) {
  try {
    const x = new URL(u);
    return ['http:', 'https:', 'mailto:'].includes(x.protocol) ? x.href : null;
  } catch {
    return null;
  }
}

function basic(s) {
  return esc(s)
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_\n]+)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>')
    .replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
}

const link = (href, inner) => `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${inner}</a>`;

export function inline(src) {
  const toks = [];
  const put = (h) => `\u0000${toks.push(h) - 1}\u0000`;
  let s = src.replace(/`([^`\n]+)`/g, (m, c) => put(`<code>${esc(c)}</code>`));
  s = s.replace(/\[([^\]\n]+)\]\(<?(https?:\/\/[^\s)>]+|mailto:[^\s)>]+)>?(?:\s+"[^"]*")?\)/g, (m, t, u) => {
    const h = safeUrl(u);
    return h ? put(link(h, basic(t))) : m;
  });
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<>()]*[^\s<>().,;:!?'"\]])/g, (m, pre, u) => {
    const h = safeUrl(u);
    return h ? pre + put(link(h, esc(u.replace(/^https?:\/\/(www\.)?/, '')))) : m;
  });
  return basic(s).replace(/\u0000(\d+)\u0000/g, (m, i) => toks[+i]);
}

const RE = {
  fence: /^\s*(```+|~~~+)\s*([\w+#.-]*)\s*$/,
  heading: /^(#{1,6})\s+(.*?)\s*#*\s*$/,
  hr: /^\s*([-*_])(\s*\1){2,}\s*$/,
  quote: /^\s*>\s?/,
  list: /^(\s*)([-*+]|\d+[.)])\s+(.*)$/,
  tableSep: /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/,
};

const splitRow = (line) =>
  line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

function isBlockStart(lines, i) {
  const l = lines[i];
  return (
    RE.fence.test(l) || RE.heading.test(l) || RE.hr.test(l) || RE.quote.test(l) || RE.list.test(l) ||
    (l.includes('|') && i + 1 < lines.length && RE.tableSep.test(lines[i + 1]))
  );
}

function renderList(block) {
  // block: array of lines belonging to one list (may contain nested, indented lines)
  const first = block[0].match(RE.list);
  const baseIndent = first[1].length;
  const ordered = /\d/.test(first[2]);
  const start = ordered ? parseInt(first[2], 10) : 1;
  const items = [];
  for (const line of block) {
    const m = line.match(RE.list);
    if (m && m[1].length <= baseIndent + 1) items.push([m[3]]);
    else if (items.length) items[items.length - 1].push(line.slice(Math.min(baseIndent + 2, line.search(/\S|$/))));
  }
  const tag = ordered ? 'ol' : 'ul';
  const startAttr = ordered && start !== 1 ? ` start="${start}"` : '';
  return `<${tag}${startAttr}>${items
    .map(([head, ...rest]) => {
      const task = head.match(/^\[([ xX])\]\s+(.*)$/);
      const headHtml = task
        ? `<input type="checkbox" disabled${task[1] !== ' ' ? ' checked' : ''}> ${inline(task[2])}`
        : inline(head);
      const nested = rest.filter((r) => r.trim()).length ? renderMarkdown(rest.join('\n')) : '';
      return `<li>${headHtml}${nested}</li>`;
    })
    .join('')}</${tag}>`;
}

export function renderMarkdown(md) {
  const lines = String(md || '').replace(/\r\n?/g, '\n').split('\n');
  let html = '';
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    const fence = line.match(RE.fence);
    if (fence) {
      const buf = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) buf.push(lines[i++]);
      i++;
      const lang = fence[2] ? ` data-lang="${esc(fence[2])}"` : '';
      html += `<pre${lang}><button class="copy-code" type="button" title="Copy">Copy</button><code>${esc(buf.join('\n'))}</code></pre>`;
      continue;
    }
    if (!line.trim()) { i++; continue; }

    const h = line.match(RE.heading);
    if (h) { const n = h[1].length; html += `<h${n}>${inline(h[2])}</h${n}>`; i++; continue; }

    if (RE.hr.test(line)) { html += '<hr>'; i++; continue; }

    if (RE.quote.test(line)) {
      const buf = [];
      while (i < lines.length && lines[i].trim() && RE.quote.test(lines[i])) buf.push(lines[i++].replace(RE.quote, ''));
      html += `<blockquote>${renderMarkdown(buf.join('\n'))}</blockquote>`;
      continue;
    }

    if (line.includes('|') && i + 1 < lines.length && RE.tableSep.test(lines[i + 1])) {
      const head = splitRow(line);
      const aligns = splitRow(lines[i + 1]).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : ''));
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(splitRow(lines[i++]));
      const cell = (t, c, j) => `<${t}${aligns[j] ? ` style="text-align:${aligns[j]}"` : ''}>${inline(c)}</${t}>`;
      html += `<div class="table-wrap"><table><thead><tr>${head.map((c, j) => cell('th', c, j)).join('')}</tr></thead><tbody>${rows
        .map((r) => `<tr>${head.map((_, j) => cell('td', r[j] || '', j)).join('')}</tr>`)
        .join('')}</tbody></table></div>`;
      continue;
    }

    if (RE.list.test(line)) {
      const buf = [line];
      const first = line.match(RE.list);
      const baseIndent = first[1].length;
      const ordered = /\d/.test(first[2]);
      i++;
      while (i < lines.length) {
        const l = lines[i];
        if (!l.trim()) {
          // blank line: continue list only if the next line is still part of it
          const next = lines[i + 1];
          if (next && (RE.list.test(next) || /^\s{2,}\S/.test(next))) { i++; continue; }
          break;
        }
        const m = l.match(RE.list);
        if (m && m[1].length <= baseIndent + 1 && /\d/.test(m[2]) !== ordered) break; // list type changed
        if (m || l.search(/\S/) > baseIndent) { buf.push(l); i++; continue; }
        break;
      }
      html += renderList(buf);
      continue;
    }

    const buf = [];
    while (i < lines.length && lines[i].trim() && !(buf.length && isBlockStart(lines, i))) buf.push(lines[i++].trim());
    html += `<p>${buf.map(inline).join('<br>')}</p>`;
  }
  return html;
}
