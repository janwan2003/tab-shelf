// Import and export formats. Pure functions, no browser APIs (unit-tested in Node).

export const FORMAT_ID = 'tabhaven';
export const FORMAT_VERSION = 1;

const URL_RE = /^[a-z][a-z0-9+.-]*:\S+$/i;

export function looksLikeUrl(s) {
  return typeof s === 'string' && URL_RE.test(s.trim());
}

// ---- import ----------------------------------------------------------------

// Returns {format, groups:[{title, createdAt?, id?, starred?, locked?, tabs:[{url,title}]}]}
export function parseImport(text) {
  const src = String(text || '').replace(/^\uFEFF/, '');
  const trimmed = src.trim();
  if (!trimmed) return { format: 'empty', groups: [] };

  // A Tabhaven HTML backup carries its data as embedded JSON.
  const embedded = trimmed.match(/<script[^>]*id="tabhaven-data"[^>]*>([\s\S]*?)<\/script>/i);
  if (embedded) {
    const r = parseJSONImport(JSON.parse(embedded[1]));
    return { ...r, format: 'tabhaven-html' };
  }

  if (trimmed[0] === '{' || trimmed[0] === '[') {
    try {
      return parseJSONImport(JSON.parse(trimmed));
    } catch (e) {
      if (!(e instanceof SyntaxError)) throw e;
      // fall through: maybe a text list that happens to start with a bracket
    }
  }

  if (/<a\s[^>]*href=/i.test(trimmed)) return parseHTMLLinks(trimmed);
  return parseTextList(trimmed);
}

export function parseJSONImport(data) {
  if (data && data.format === FORMAT_ID && Array.isArray(data.groups)) {
    return {
      format: 'tabhaven',
      groups: data.groups
        .filter((g) => g && Array.isArray(g.tabs))
        .map((g) => ({
          id: typeof g.id === 'string' ? g.id : undefined,
          title: String(g.title || ''),
          createdAt: Number(g.createdAt) || undefined,
          starred: !!g.starred,
          locked: !!g.locked,
          tabs: g.tabs.filter((t) => t && looksLikeUrl(t.url)).map((t) => ({ url: t.url.trim(), title: String(t.title || ''), ...(t.pinned ? { pinned: true } : {}) })),
        }))
        .filter((g) => g.tabs.length),
    };
  }
  return { format: 'json', groups: findTabGroupsInJSON(data) };
}

function tabUrl(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  for (const k of ['url', 'href', 'uri']) {
    if (looksLikeUrl(o[k])) return o[k].trim();
  }
  return null;
}

function nodeTitle(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return '';
  for (const k of ['title', 'name', 'label', 'customTitle']) {
    if (typeof o[k] === 'string' && o[k].trim()) return o[k].trim();
  }
  return '';
}

function nodeDate(o) {
  if (!o || typeof o !== 'object') return undefined;
  for (const k of ['createdAt', 'created', 'date', 'dateCreated', 'gen', 'time', 'timestamp']) {
    const v = o[k];
    const n = typeof v === 'number' ? v : typeof v === 'string' ? Date.parse(v) : NaN;
    if (Number.isFinite(n) && n > 946684800000 && n < 4102444800000) return n; // 2000..2100
  }
  return undefined;
}

// Walk any JSON document (Session Buddy, Tab Session Manager, Toby and most other exports)
// and turn every array or object that directly holds tab-like objects into a group.
export function findTabGroupsInJSON(root) {
  const groups = [];
  const seen = new WeakSet();
  function walk(node, ctx, depth) {
    if (!node || typeof node !== 'object' || seen.has(node) || depth > 40) return;
    seen.add(node);
    const children = Array.isArray(node) ? node : Object.values(node);
    const title = Array.isArray(node) ? ctx.title : nodeTitle(node) || ctx.title;
    const date = (Array.isArray(node) ? undefined : nodeDate(node)) || ctx.date;
    const tabs = [];
    for (const c of children) {
      const url = tabUrl(c);
      if (url) tabs.push({ url, title: nodeTitle(c) || url, ...(c.pinned ? { pinned: true } : {}) });
    }
    if (tabs.length) groups.push({ title, createdAt: date, tabs });
    for (const c of children) {
      if (c && typeof c === 'object' && !tabUrl(c)) walk(c, { title, date }, depth + 1);
    }
  }
  walk(root, { title: '', date: undefined }, 0);
  return groups;
}

// "URL | title" lines (the common tab-list export format), plain URL lists and
// Markdown links. Blank lines separate groups.
export function parseTextList(text) {
  const groups = [];
  let cur = [];
  let title = '';
  const flush = () => {
    if (!cur.length) return; // a heading's title survives the blank line after it
    groups.push({ title, tabs: cur });
    cur = [];
    title = '';
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    let m;
    if ((m = line.match(/^[-*+]?\s*\[([^\]]*)\]\((\S+?)\)\s*$/)) && looksLikeUrl(m[2])) {
      cur.push({ url: m[2], title: m[1] || m[2] });
    } else if ((m = line.match(/^#{1,6}\s+(.*)$/))) {
      flush();
      title = m[1].trim();
      cur = [];
    } else {
      const bar = line.indexOf(' | ');
      const url = bar >= 0 ? line.slice(0, bar).trim() : line;
      if (looksLikeUrl(url)) cur.push({ url, title: bar >= 0 ? line.slice(bar + 3).trim() || url : url });
    }
  }
  flush();
  return { format: 'text', groups };
}

function decodeEntities(s) {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');
}

// Any HTML page with links, e.g. a browser bookmarks export.
export function parseHTMLLinks(html) {
  const groups = [];
  let cur = { title: '', tabs: [] };
  const re = /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>|<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    if (m[1] !== undefined) {
      if (cur.tabs.length) groups.push(cur);
      cur = { title: decodeEntities(m[1].replace(/<[^>]+>/g, '').trim()), tabs: [] };
    } else {
      const url = decodeEntities(m[2]);
      if (!looksLikeUrl(url) || /^javascript:/i.test(url)) continue;
      cur.tabs.push({ url, title: decodeEntities(m[3].replace(/<[^>]+>/g, '').trim()) || url });
    }
  }
  if (cur.tabs.length) groups.push(cur);
  return { format: 'html', groups };
}

// ---- export ----------------------------------------------------------------

export function toJSON(groups, now = Date.now()) {
  return JSON.stringify({ format: FORMAT_ID, version: FORMAT_VERSION, exportedAt: new Date(now).toISOString(), groups }, null, 1);
}

export function toText(groups) {
  return groups.map((g) => g.tabs.map((t) => `${t.url} | ${oneLine(t.title)}`).join('\n')).join('\n\n') + '\n';
}

export function toMarkdown(groups) {
  return groups
    .map((g) => `## ${oneLine(groupLabel(g))}\n\n` + g.tabs.map((t) => `- [${oneLine(t.title).replace(/[[\]]/g, '\\$&')}](${t.url.replace(/[()\s]/g, encodeURIComponent)})`).join('\n'))
    .join('\n\n') + '\n';
}

export function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function oneLine(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

export function formatDate(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function groupLabel(g) {
  return g.title || `${g.tabs.length} tab${g.tabs.length === 1 ? '' : 's'}, saved ${formatDate(g.createdAt)}`;
}

// A readable page of links that also embeds the full data, so the file alone can be re-imported.
export function toHTML(groups, now = Date.now()) {
  const total = groups.reduce((n, g) => n + g.tabs.length, 0);
  const body = groups
    .map((g) => `<h2>${escapeHTML(groupLabel(g))}</h2>\n<ul>\n${g.tabs.map((t) => `<li><a href="${escapeHTML(t.url)}">${escapeHTML(oneLine(t.title) || t.url)}</a></li>`).join('\n')}\n</ul>`)
    .join('\n');
  const data = toJSON(groups, now).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Tabhaven backup ${escapeHTML(formatDate(now))}</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:60rem;margin:2rem auto;padding:0 1rem;color:#1f2937}h1{color:#0f766e}h2{font-size:1rem;margin-top:1.6rem;border-bottom:1px solid #e5e7eb}ul{padding-left:1.2rem}a{color:#0f766e;word-break:break-word}</style>
</head><body>
<h1>Tabhaven backup</h1>
<p>${total} tabs in ${groups.length} groups, written ${escapeHTML(formatDate(now))}. To restore everything, open Tabhaven, choose <b>Import</b> and pick this file.</p>
${body}
<script type="application/json" id="tabhaven-data">${data}</script>
</body></html>
`;
}
