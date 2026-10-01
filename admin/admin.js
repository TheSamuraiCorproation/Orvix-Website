/* Perspectives admin (browser side).
 *
 * Talks only to the same-origin /api/ endpoints. Every value that comes back
 * from the API is treated as untrusted text: it reaches the DOM through
 * textContent / element properties, or (article text only) through
 * renderMarkdown(), which HTML-escapes its whole input before adding tags.
 *
 * Editors write in a word-processor style editor (contenteditable). Posts are
 * still STORED as the markdown subset that tools/blog/markdown.py renders:
 * stored markdown -> renderMarkdown() -> editor DOM -> domToMarkdown() -> saved.
 * Editors never see markdown.
 *
 * No inline handlers, no eval: runs under script-src 'self'.
 */
'use strict';

/* ------------------------------------------------------------------ *
 * Markdown subset renderer. MUST stay identical to tools/blog/markdown.py.
 * ------------------------------------------------------------------ */

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const MD_LINK = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;
const MD_BOLD = /\*\*(.+?)\*\*/g;
// Same as markdown.py _ITAL (re.ASCII): a word character or another marker
// next to the opening/closing mark blocks italics, so snake_case stays as typed.
const MD_ITAL = /(?<![*\w])\*(?!\s)([^*\n]+?)\*(?![*\w])|(?<![_\w])_(?!\s)([^_\n]+?)_(?![_\w])/g;
const MD_OL = /^\d+\. /;

// ***x*** first so bold+italic nests properly (same order as markdown.py)
const MD_BOTH = /\*\*\*(?!\s)(.+?)\*\*\*/g;

function emphasis(s) {
  return s
    .replace(MD_BOTH, '<strong><em>$1</em></strong>')
    .replace(MD_BOLD, '<strong>$1</strong>')
    .replace(MD_ITAL, (m, a, b) => '<em>' + (a !== undefined ? a : b) + '</em>');
}

function linkTag(url, text) {
  const external = url.startsWith('https://') || url.startsWith('http://');
  return '<a href="' + url + '"' + (external ? ' target="_blank" rel="noopener noreferrer"' : '') + '>' + text + '</a>';
}

// Inline rules on already-escaped text. Valid links become placeholders first
// so bold/italic never reach inside a URL; link text still gets them.
function inline(s) {
  const links = [];
  const held = s.replace(MD_LINK, (whole, text, url) => {
    if (!(url.startsWith('https://') || url.startsWith('http://') || url.startsWith('/'))) return whole;
    links.push([text, url]);
    return '\u0000' + (links.length - 1) + '\u0000';
  });
  return emphasis(held).replace(/\u0000(\d+)\u0000/g, (m, i) => {
    const l = links[Number(i)];
    return linkTag(l[1], emphasis(l[0]));
  });
}

function renderMarkdown(src) {
  const raw = String(src == null ? '' : src).replace(/\u0000/g, '').replace(/\r\n?/g, '\n');
  const text = escapeHtml(raw).trim();
  const out = [];
  if (!text) return '';
  for (const block of text.split(/\n\s*\n/)) {
    const lines = block.split('\n').filter((l) => l.trim()).map((l) => l.trimEnd());
    if (!lines.length) continue;
    const first = lines[0];
    // Note: '>' is already escaped, so a quote line starts with '&gt; '.
    if (first.startsWith('### ')) {
      out.push('<h3>' + inline([first.slice(4)].concat(lines.slice(1)).join(' ')) + '</h3>');
    } else if (first.startsWith('## ')) {
      out.push('<h2>' + inline([first.slice(3)].concat(lines.slice(1)).join(' ')) + '</h2>');
    } else if (lines.every((l) => l.startsWith('- ') || l.startsWith('* '))) {
      out.push('<ul>' + lines.map((l) => '<li>' + inline(l.slice(2)) + '</li>').join('') + '</ul>');
    } else if (lines.every((l) => MD_OL.test(l))) {
      out.push('<ol>' + lines.map((l) => '<li>' + inline(l.replace(MD_OL, '')) + '</li>').join('') + '</ol>');
    } else if (lines.every((l) => l.startsWith('&gt; ') || l === '&gt;')) {
      out.push('<blockquote><p>' + lines.map((l) => inline(l.slice(5))).join('<br>') + '</p></blockquote>');
    } else {
      out.push('<p>' + lines.map(inline).join('<br>') + '</p>');
    }
  }
  return out.join('\n');
}

// Word count as in markdown.py plain_words(): Python's Unicode \w plus Arabic.
function plainWords(md) {
  const m = String(md || '').replace(/\]\([^)]*\)/g, ']').match(/[\p{L}\p{N}_؀-ۿ]+/gu);
  return m ? m.length : 0;
}
// Python's round() rounds halves to even; match it so the minutes agree.
function roundHalfEven(x) {
  const f = Math.floor(x);
  const d = x - f;
  if (d > 0.5) return f + 1;
  if (d < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}
function readMinutes(md) { return Math.max(1, roundHalfEven(plainWords(md) / 220)); }

/* ------------------------------------------------------------------ *
 * Editor DOM -> markdown subset
 * ------------------------------------------------------------------ */

const BLOCK_TAGS = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'BLOCKQUOTE',
  'PRE', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TD', 'TH', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER',
  'FIGURE', 'FIGCAPTION', 'ASIDE', 'NAV', 'HR', 'DL', 'DT', 'DD', 'ADDRESS', 'MAIN', 'CAPTION']);
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'IFRAME', 'OBJECT', 'EMBED', 'SVG',
  'MATH', 'HEAD', 'TITLE', 'META', 'LINK', 'IMG', 'VIDEO', 'AUDIO', 'CANVAS', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA']);

const tagName = (n) => (n && n.nodeType === 1 ? n.nodeName.toUpperCase() : '');
const isBlockEl = (n) => BLOCK_TAGS.has(tagName(n));

// What the renderer turns into a link (the editor's link box is stricter).
function hrefRenderable(h) {
  return typeof h === 'string' && (h.startsWith('https://') || h.startsWith('http://') || h.startsWith('/'));
}
// Keep a URL inside [text](url): no spaces or parentheses.
function mdUrl(h) {
  return h.trim().replace(/\s/g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29');
}

function splitEdges(s) {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s);
  return [m[1], m[2], m[3]];
}

// Wrap each line's text in a marker pair, with edge spaces moved outside the
// markers. A candidate is used only if the renderer turns it back into the
// intended tag; otherwise the formatting is dropped rather than leaving
// stray asterisks in the published article.
// strict: return null instead of dropping the formatting of a line.
function wrapLines(s, candidates, tag, strict) {
  let failed = false;
  const out = s.split('\n').map((line) => {
    const [lead, core, trail] = splitEdges(line);
    if (!core) return line;
    const want = '<' + tag + '>' + inline(escapeHtml(core)) + '</' + tag + '>';
    for (const [open, close] of candidates) {
      const c = open + core + close;
      if (inline(escapeHtml(c)) === want) return lead + c + trail;
    }
    failed = true;
    return line;
  }).join('\n');
  return failed && strict ? null : out;
}

// Last character before / first character after node n inside its block.
function charBeside(n, before) {
  let cur = n;
  while (cur && !isBlockEl(cur) && !(cur.classList && cur.classList.contains('rte'))) {
    let sib = before ? cur.previousSibling : cur.nextSibling;
    while (sib) {
      if (tagName(sib) === 'BR' || isBlockEl(sib)) return '\n';
      const t = sib.textContent;
      if (t) return before ? t[t.length - 1] : t[0];
      sib = before ? sib.previousSibling : sib.nextSibling;
    }
    cur = cur.parentNode;
  }
  return '';
}

function inlineMd(node, ctx) {
  let s = '';
  for (const c of node.childNodes) s += inlineNode(c, ctx);
  return s;
}

function inlineNode(n, ctx) {
  if (n.nodeType === 3) return n.nodeValue.replace(/\s+/g, ' ');
  if (n.nodeType !== 1) return '';
  const tag = tagName(n);
  if (SKIP_TAGS.has(tag)) return '';
  if (tag === 'BR') return ctx.br;
  if ((tag === 'UL' || tag === 'OL') && ctx.inLi) return ''; // handled as separate items
  if (tag === 'STRONG' || tag === 'B') {
    if (ctx.strong) return inlineMd(n, ctx);
    // Italics written *x* can collide with the ** around them ("**a *b***");
    // if the bold does not come back intact, write the italics as _x_.
    const first = inlineMd(n, Object.assign({}, ctx, { strong: true }));
    const ok = wrapLines(first, [['**', '**']], 'strong', true);
    if (ok !== null) return ok;
    const second = inlineMd(n, Object.assign({}, ctx, { strong: true, emUnderscore: true }));
    return wrapLines(second, [['**', '**']], 'strong', false);
  }
  if (tag === 'EM' || tag === 'I') {
    const inner = inlineMd(n, Object.assign({}, ctx, { em: true }));
    if (ctx.em) return inner;
    // The renderer will not italicise text glued to a letter or digit
    // (e.g. half a word); drop the formatting instead of printing asterisks.
    if (/[\w*]/.test(charBeside(n, true)) || /[\w*]/.test(charBeside(n, false))) return inner;
    return wrapLines(inner, ctx.emUnderscore ? [['_', '_'], ['*', '*']] : [['*', '*'], ['_', '_']], 'em');
  }
  if (tag === 'A') {
    const href = (n.getAttribute('href') || '').trim();
    const inner = inlineMd(n, Object.assign({}, ctx, { br: ' ', link: true }));
    if (ctx.link || !hrefRenderable(href)) return inner;
    const [lead, core, trail] = splitEdges(inner.replace(/\s+/g, ' '));
    const url = mdUrl(href);
    const text = (core || url).replace(/\[/g, '(').replace(/\]/g, ')');
    return lead + '[' + text + '](' + url + ')' + trail;
  }
  if (isBlockEl(n)) return ctx.br + inlineMd(n, ctx) + ctx.br;
  return inlineMd(n, ctx); // span, u, code, font, ...: keep the text
}

const oneLine = (s) => s.replace(/\s+/g, ' ').trim();

// Push one or more paragraphs from a run of inline nodes (an empty line splits).
function paragraphMd(nodes, out, plain) {
  let s = '';
  for (const n of nodes) s += inlineNode(n, { br: '\n' });
  let cur = [];
  const flush = () => { if (cur.length) { out.push(cur.join('\n')); cur = []; } };
  for (const raw of s.split('\n')) {
    const line = raw.replace(/ {2,}/g, ' ').trim();
    if (line) cur.push(line); else flush();
  }
  flush();
}

function listItems(list, items) {
  for (const c of list.childNodes) {
    const tag = tagName(c);
    if (tag === 'LI') {
      const t = oneLine(inlineMd(c, { br: ' ', inLi: true }));
      if (t) items.push(t);
      for (const sub of c.querySelectorAll('ul,ol')) {
        if (sub.parentElement && sub.parentElement.closest('li') === c) listItems(sub, items);
      }
    } else if (tag === 'UL' || tag === 'OL') {
      listItems(c, items);
    } else if (c.nodeType === 3 || c.nodeType === 1) {
      const t = oneLine(c.nodeType === 3 ? c.nodeValue : inlineMd(c, { br: ' ' }));
      if (t) items.push(t);
    }
  }
}

function quoteLines(container) {
  const lines = [];
  let run = [];
  const flush = () => {
    if (!run.length) return;
    let s = '';
    for (const n of run) s += inlineNode(n, { br: '\n' });
    const ls = s.split('\n').map((l) => l.replace(/ {2,}/g, ' ').trim());
    while (ls.length && !ls[ls.length - 1]) ls.pop(); // the browser's trailing <br>
    while (ls.length && !ls[0]) ls.shift();
    lines.push(...ls);
    run = [];
  };
  for (const n of container.childNodes) {
    const tag = tagName(n);
    if (tag === 'UL' || tag === 'OL') { flush(); const items = []; listItems(n, items); lines.push(...items); }
    else if (/^H[1-6]$/.test(tag)) { flush(); const t = oneLine(inlineMd(n, { br: ' ' })); if (t) lines.push(t); }
    else if (isBlockEl(n)) { flush(); lines.push(...quoteLines(n)); }
    else run.push(n);
  }
  flush();
  return lines;
}

// plain: inside a quote, where heading/list markers would be literal text.
function blockMd(n, out, plain) {
  const tag = tagName(n);
  if (SKIP_TAGS.has(tag) || tag === 'HR') return;
  if (/^H[1-6]$/.test(tag) && ![...n.children].some(isBlockEl)) {
    const t = oneLine(inlineMd(n, { br: ' ' }));
    if (t) out.push((plain ? '' : (tag === 'H1' || tag === 'H2' ? '## ' : '### ')) + t);
    return;
  }
  if (tag === 'UL' || tag === 'OL') {
    const items = [];
    listItems(n, items);
    if (items.length) out.push(items.map((t, i) => (plain ? '' : tag === 'OL' ? (i + 1) + '. ' : '- ') + t).join('\n'));
    return;
  }
  if (tag === 'BLOCKQUOTE') {
    // One quote block: its paragraphs follow each other line by line; an
    // empty line inside a paragraph is kept as a bare ">".
    const lines = quoteLines(n).join('\n').replace(/\n{3,}/g, '\n\n').trim().split('\n');
    if (lines.join('')) out.push(lines.map((l) => (plain ? l : l ? '> ' + l : '>')).join('\n'));
    return;
  }
  // p, div, li outside a list, table parts, anything else: a container whose
  // inline runs are paragraphs.
  collectBlocks(n, out, plain);
}

function collectBlocks(container, out, plain) {
  let run = [];
  const flush = () => { if (run.length) { paragraphMd(run, out, plain); run = []; } };
  for (const n of container.childNodes) {
    if (isBlockEl(n)) { flush(); blockMd(n, out, plain); } else run.push(n);
  }
  flush();
}

function domToMarkdown(root) {
  const out = [];
  collectBlocks(root, out, false);
  return out.map((b) => b.trim()).filter(Boolean).join('\n\n');
}

/* ------------------------------------------------------------------ *
 * Paste sanitising
 * ------------------------------------------------------------------ */

const PASTE_MAP = { P: 'p', DIV: 'p', H1: 'h2', H2: 'h2', H3: 'h3', H4: 'h3', H5: 'h3', H6: 'h3',
  STRONG: 'strong', B: 'strong', EM: 'em', I: 'em', A: 'a', UL: 'ul', OL: 'ol', LI: 'li',
  BLOCKQUOTE: 'blockquote', BR: 'br', TR: 'p', DT: 'p', DD: 'p', PRE: 'p', FIGCAPTION: 'p' };
const PASTE_CONTAINERS = new Set(['UL', 'OL', 'BLOCKQUOTE', 'DIV']);

// Rebuilds pasted HTML from scratch with createElement/createTextNode, keeping
// only the allowed elements and, on links, only a safe href. Nothing from the
// clipboard is ever assigned as HTML.
function sanitizeInto(src, dst) {
  for (const n of src.childNodes) {
    if (n.nodeType === 3) {
      const t = n.nodeValue.replace(/\s+/g, ' ');
      if (!t.trim() && (PASTE_CONTAINERS.has(tagName(dst)) || dst.isRoot)) continue;
      dst.appendChild(document.createTextNode(t));
      continue;
    }
    if (n.nodeType !== 1) continue;
    const tag = tagName(n);
    if (SKIP_TAGS.has(tag)) continue;
    const style = n.getAttribute('style') || '';
    let map = PASTE_MAP[tag] || null;
    // Google Docs wraps everything in <b style="font-weight:normal">; spans carry real bold/italic as styles.
    if (tag === 'B' && /font-weight\s*:\s*(normal|[1-4]00)/i.test(style)) map = null;
    if (tag === 'SPAN') {
      if (/font-weight\s*:\s*(bold|[6-9]00)/i.test(style)) map = 'strong';
      else if (/font-style\s*:\s*italic/i.test(style)) map = 'em';
    }
    if (map === 'a') {
      const href = (n.getAttribute('href') || '').trim();
      if (!linkAllowed(href)) map = null;
    }
    if (!map) { sanitizeInto(n, dst); continue; } // unwrap
    const el = document.createElement(map);
    if (map === 'a') el.setAttribute('href', n.getAttribute('href').trim());
    if (map !== 'br') sanitizeInto(n, el);
    dst.appendChild(el);
  }
}

function sanitizePastedHtml(html) {
  // DOMParser builds an inert document: no scripts run, nothing loads.
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out = document.createElement('div');
  out.isRoot = true;
  sanitizeInto(doc.body, out);
  // Loose text between pasted blocks becomes its own paragraph.
  if ([...out.children].some(isBlockEl)) ensureBlocks(out);
  return out;
}

function textToHtml(text) {
  return String(text).replace(/\r\n?/g, '\n').trim().split(/\n\s*\n/)
    .map((p) => '<p>' + p.split('\n').map(escapeHtml).join('<br>') + '</p>').join('');
}

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

const $ = (id) => document.getElementById(id);
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SLUG_MAX = 80;
const MAX_INPUT_BYTES = 15 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 3 * 1024 * 1024;
const MAX_SIDE = 1600;
const LANGS = ['en', 'ar'];
const MONTHS = {
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  ar: ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'],
};
const COPY = {
  en: { label: 'Perspective', brand: 'Orvix', min: (n) => n + ' min read' },
  ar: { label: 'وجهة نظر', brand: 'أورفكس', min: (n) => (n === 1 ? 'دقيقة قراءة' : n + ' دقائق قراءة') },
};

function str(v) { return typeof v === 'string' ? v : ''; }
function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
function validSlug(s) { return typeof s === 'string' && s.length <= SLUG_MAX && SLUG_RE.test(s); }
// What the link box accepts: http(s) with a host, or a site path (not //host).
function linkAllowed(h) { return /^(https?:\/\/[^\s/?#]+\S*|\/(?!\/)\S*)$/.test(h); }

// English title -> slug. Accents are folded to ASCII; anything else that is
// not a-z0-9 becomes a separator. Arabic-only text yields ''.
function slugify(title) {
  let s = str(title).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (s.length > SLUG_MAX) s = s.slice(0, SLUG_MAX).replace(/-+$/, '');
  return s;
}

// Lenient clean-up while the user types in the slug field (keeps a trailing
// '-' so they can keep typing the next word).
function softSlug(s) {
  return str(s).toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
    .replace(/-{2,}/g, '-').replace(/^-+/, '').slice(0, SLUG_MAX);
}

function articleUrl(slug) { return '/research/perspectives/' + slug + '/'; }

// Only same-site, root-relative image paths are shown (never //host or schemes).
function safeImagePath(p) {
  return typeof p === 'string' && /^\/(?!\/)[A-Za-z0-9._\/-]+$/.test(p) ? p : '';
}

function fmtUpdated(v) {
  const s = str(v);
  if (!s) return '';
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// "2026-10-01" -> "1 October 2026" (as tools/blog nice_date).
function niceDate(iso, lang) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str(iso));
  if (!m) return '';
  return Number(m[3]) + ' ' + MONTHS[lang][Number(m[2]) - 1] + ' ' + m[1];
}
function todayIso() { return new Date().toISOString().slice(0, 10); }

function el(tag, attrs, text) {
  const n = document.createElement(tag);
  if (attrs) for (const k of Object.keys(attrs)) n.setAttribute(k, attrs[k]);
  if (text != null) n.textContent = text;
  return n;
}

/* ------------------------------------------------------------------ *
 * API
 * ------------------------------------------------------------------ */

class ApiError extends Error {
  constructor(kind, message, status) { super(message); this.kind = kind; this.status = status; }
}

// kind: 'auth' (401), 'network', 'http'.
async function api(method, path, body) {
  const opts = {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    redirect: 'manual', // the API never redirects fetches; treat one as signed out
    headers: { Accept: 'application/json' },
  };
  if (method !== 'GET') {
    opts.headers['Content-Type'] = 'application/json';
    opts.headers['X-Orvix-Admin'] = '1';
    opts.body = JSON.stringify(body === undefined ? {} : body);
  }
  let res;
  try {
    res = await fetch(path, opts);
  } catch (e) {
    throw new ApiError('network', 'Could not reach the server.', 0);
  }
  if (res.type === 'opaqueredirect' || res.status === 401) {
    throw new ApiError('auth', 'You are not signed in.', res.status);
  }
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  if (!res.ok) {
    const msg = isObj(data) && typeof data.error === 'string' && data.error
      ? data.error.slice(0, 300)
      : 'The server answered with an error (' + res.status + ').';
    throw new ApiError('http', msg, res.status);
  }
  if (!isObj(data)) throw new ApiError('http', 'Unexpected response from the server.', res.status);
  return data;
}

/* ------------------------------------------------------------------ *
 * Views, toasts, dialog
 * ------------------------------------------------------------------ */

const VIEWS = ['loading', 'signin', 'error', 'list', 'editor'];
let currentView = 'loading';

function show(view) {
  currentView = view;
  for (const v of VIEWS) $('view-' + v).hidden = v !== view;
  window.scrollTo(0, 0);
}

function showError(detail) {
  $('error-detail').textContent = detail || 'Check your connection and try again in a moment.';
  show('error');
}

// After a first publish the server drafts the newsletter in Brevo (never sends it).
function newsletterToast(n) {
  const name = { en: 'English', ar: 'Arabic' };
  const made = (Array.isArray(n.created) ? n.created : []).map((c) => name[c.lang] || c.lang);
  const failed = (Array.isArray(n.errors) ? n.errors : []).map((c) => name[c.lang] || c.lang);
  const noList = (Array.isArray(n.created) ? n.created : []).some((c) => c.list === false);
  if (made.length) toast('Newsletter drafted in Brevo (' + made.join(' + ') + '). Marketing reviews it under Campaigns and clicks Send.'
    + (noList ? ' Choose the subscriber list in Brevo before sending.' : ''));
  if (failed.length) toast('The ' + failed.join(' and ') + ' newsletter draft could not be created in Brevo. The post is published; create the email in Brevo by hand.', true);
}

function toast(message, isError) {
  const t = el('div', { class: 'toast' + (isError ? ' err' : '') });
  if (isError) t.setAttribute('role', 'alert');
  t.appendChild(el('span', { class: 'toast-msg' }, message));
  const x = el('button', { type: 'button', class: 'toast-x', 'aria-label': 'Dismiss' }, '×');
  x.addEventListener('click', () => t.remove());
  t.appendChild(x);
  $('toasts').appendChild(t);
  setTimeout(() => t.remove(), isError ? 10000 : 5000);
}

// Promise-based in-page confirm built on <dialog>. Resolves true / false.
function ask(title, text, okLabel, danger) {
  const dlg = $('dlg');
  $('dlg-title').textContent = title;
  $('dlg-text').textContent = text;
  const ok = $('dlg-ok');
  ok.textContent = okLabel || 'OK';
  ok.className = 'btn ' + (danger ? 'btn-danger' : 'btn-primary');
  const opener = document.activeElement;
  return new Promise((resolve) => {
    const done = (v) => {
      ok.removeEventListener('click', onOk);
      $('dlg-cancel').removeEventListener('click', onCancel);
      dlg.removeEventListener('close', onClose);
      if (dlg.open) dlg.close();
      if (opener && opener.focus && document.contains(opener)) opener.focus();
      resolve(v);
    };
    const onOk = () => done(true);
    const onCancel = () => done(false);
    const onClose = () => done(false); // Escape key
    ok.addEventListener('click', onOk);
    $('dlg-cancel').addEventListener('click', onCancel);
    dlg.addEventListener('close', onClose);
    dlg.showModal();
    $('dlg-cancel').focus();
  });
}

/* ------------------------------------------------------------------ *
 * Sign-in (emailed link)
 * ------------------------------------------------------------------ */

let pendingRetry = null; // action to re-run after re-authenticating mid-edit

function setSignedIn(email) {
  $('who-email').textContent = email || '';
  $('who-email').hidden = !email;
  $('btn-signout').hidden = false;
}
function setSignedOut() {
  $('who-email').textContent = '';
  $('who-email').hidden = true;
  $('btn-signout').hidden = true;
}

// Reset the sign-in box to the email form. midEdit: show the
// "your work is still here" text and the Retry row.
function resetSignin(midEdit) {
  $('signin-form').hidden = false;
  $('signin-sent').hidden = true;
  $('signin-error').hidden = true;
  $('signin-submit').disabled = false;
  $('signin-context').hidden = !midEdit;
  $('signin-retry-row').hidden = !midEdit;
  if (midEdit) $('signin-expired').hidden = true;
}

function showSigninView() {
  setSignedOut();
  const box = $('signin-box');
  if (box.parentNode !== $('signin-home')) $('signin-home').appendChild(box);
  if ($('auth-dlg').open) $('auth-dlg').close();
  pendingRetry = null;
  resetSignin(false);
  show('signin');
  $('signin-email').focus();
}

// A 401 while editing: keep the editor and its unsaved work, and offer
// sign-in in a dialog. retry runs once the session is back.
function handleAuthLoss(retry) {
  if (currentView !== 'editor') return showSigninView();
  pendingRetry = retry || null;
  const dlg = $('auth-dlg');
  dlg.appendChild($('signin-box'));
  resetSignin(true);
  if (!dlg.open) dlg.showModal();
  $('signin-email').focus();
}

async function submitSignin(e) {
  e.preventDefault();
  const input = $('signin-email');
  const email = input.value.trim();
  const errBox = $('signin-error');
  errBox.hidden = true;
  input.removeAttribute('aria-invalid');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errBox.textContent = 'Enter your full email address.';
    errBox.hidden = false;
    input.setAttribute('aria-invalid', 'true');
    input.focus();
    return;
  }
  $('signin-submit').disabled = true;
  try {
    await api('POST', '/api/login', { email });
    $('signin-sent-text').textContent = 'Check your inbox. If ' + email +
      ' is an approved address, a sign-in link is on its way. It works for 15 minutes.';
    $('signin-form').hidden = true;
    $('signin-sent').hidden = false;
    $('signin-expired').hidden = true;
    $('signin-again').focus();
  } catch (err) {
    errBox.textContent = err.kind === 'network'
      ? 'Could not reach the server. Check your connection and try again.'
      : err.message;
    errBox.hidden = false;
  } finally {
    $('signin-submit').disabled = false;
  }
}

async function retryAfterSignin() {
  try {
    const me = await api('GET', '/api/me');
    setSignedIn(str(me.email));
  } catch (e) {
    toast(e.kind === 'auth'
      ? 'Still not signed in. Open the link from your email first, then press Retry.'
      : 'Could not reach the server. Try again in a moment.', true);
    return;
  }
  const run = pendingRetry;
  pendingRetry = null;
  $('auth-dlg').close();
  toast('Signed in again.');
  if (run) run();
}

async function signOut() {
  if (isDirty()) {
    const ok = await ask('Sign out and discard changes?', 'You have changes that have not been saved. Signing out now will lose them.', 'Sign out', true);
    if (!ok) return;
  }
  try {
    await api('POST', '/api/logout', {});
  } catch (e) {
    if (e.kind !== 'auth') {
      toast('Could not sign out: the server did not answer. Try again.', true);
      return;
    }
  }
  ed.baseline = '';
  clearCover();
  showSigninView();
  toast('Signed out.');
}

/* ------------------------------------------------------------------ *
 * Start-up and post list
 * ------------------------------------------------------------------ */

let knownSlugs = new Set();

async function start() {
  show('loading');
  try {
    const me = await api('GET', '/api/me');
    setSignedIn(str(me.email));
  } catch (e) {
    if (e.kind === 'auth') return showSigninView();
    if (e.kind === 'network') return showError('The admin service could not be reached. Check your connection and try again.');
    return showError(e.message);
  }
  await loadList();
}

async function loadList() {
  let data;
  try {
    data = await api('GET', '/api/posts');
  } catch (e) {
    if (e.kind === 'auth') return showSigninView();
    return showError(e.kind === 'network' ? 'The admin service could not be reached.' : e.message);
  }
  const posts = Array.isArray(data.posts) ? data.posts.filter(isObj) : [];
  knownSlugs = new Set(posts.map((p) => p.slug).filter(validSlug));
  posts.sort((a, b) => str(b.updated).localeCompare(str(a.updated)));
  renderList(posts);
  show('list');
}

function renderList(posts) {
  const body = $('posts-body');
  body.textContent = '';
  $('list-empty').hidden = posts.length > 0;
  $('posts-table').hidden = posts.length === 0;

  for (const p of posts) {
    const slug = validSlug(p.slug) ? p.slug : '';
    const published = p.status === 'published';
    const title = (isObj(p.title) && str(p.title.en).trim()) || '(untitled)';
    const tr = el('tr');

    const tdTitle = el('td');
    tdTitle.appendChild(el('span', { class: 't-title' }, title));
    tdTitle.appendChild(el('span', { class: 't-slug' }, slug || '(invalid slug)'));
    tr.appendChild(tdTitle);

    const tdStatus = el('td', { 'data-label': 'Status' });
    tdStatus.appendChild(el('span', { class: 'pill' + (published ? ' is-published' : '') }, published ? 'Published' : 'Draft'));
    tr.appendChild(tdStatus);

    tr.appendChild(el('td', { class: 't-date', 'data-label': 'Published' }, str(p.published) || '—'));
    tr.appendChild(el('td', { class: 't-date', 'data-label': 'Updated' }, fmtUpdated(p.updated) || '—'));

    const tdAct = el('td', { class: 't-actions' });
    const edit = el('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'aria-label': 'Edit ' + title }, 'Edit');
    edit.disabled = !slug;
    edit.addEventListener('click', () => openEditor(slug));
    tdAct.appendChild(edit);
    if (published && slug) {
      tdAct.appendChild(el('a', { class: 'btn btn-ghost btn-sm', href: articleUrl(slug), target: '_blank', rel: 'noopener', 'aria-label': 'View ' + title + ' (opens in a new tab)' }, 'View'));
    }
    const del = el('button', { type: 'button', class: 'btn btn-danger-ghost btn-sm', 'aria-label': 'Delete ' + title }, 'Delete');
    del.disabled = !slug;
    del.addEventListener('click', () => deletePost(slug, title, published));
    tdAct.appendChild(del);
    tr.appendChild(tdAct);

    body.appendChild(tr);
  }
}

async function deletePost(slug, title, published) {
  const ok = await ask(
    'Delete this post?',
    '“' + title + '” will be deleted' + (published ? ' and removed from the live site' : '') + '. This cannot be undone.',
    'Delete', true);
  if (!ok) return;
  try {
    await api('DELETE', '/api/posts/' + encodeURIComponent(slug));
    toast(published ? 'Deleted. It will disappear from the site in about a minute.' : 'Deleted.');
    await loadList();
  } catch (e) {
    if (e.kind === 'auth') return showSigninView();
    toast(e.kind === 'network' ? 'Could not reach the server. Nothing was deleted.' : e.message, true);
  }
}

/* ------------------------------------------------------------------ *
 * Editor state
 * ------------------------------------------------------------------ */

const ed = {
  original: null,     // last copy of the post from the server (null = new post)
  slugTouched: false, // true once the user edits the slug by hand
  lang: 'en',
  cover: null,        // image chosen this session: { base64, url, kb, uploaded }
  coverRemoved: false,
  baseline: '',       // serialised form at last load/save, for dirty checks
  busy: false,
};

const F = {
  slug: () => $('f-slug'),
  author: () => $('f-author'),
  title: (l) => $('f-title-' + l),
  summary: (l) => $('f-summary-' + l),
  body: (l) => $('f-body-' + l),
  alt: (l) => $('f-alt-' + l),
};
const bodyMd = (l) => domToMarkdown(F.body(l));

function coverPending() { return !!ed.cover && !ed.cover.uploaded; }
function isPublished() { return !!ed.original && ed.original.status === 'published'; }
// The slug is frozen once the post has ever gone live (published date set).
function slugLocked() { return !!ed.original && (ed.original.status === 'published' || !!ed.original.published); }

function snapshot() {
  const o = { slug: F.slug().value, author: F.author().value };
  for (const l of LANGS) {
    o['t' + l] = F.title(l).value; o['s' + l] = F.summary(l).value;
    o['b' + l] = bodyMd(l); o['a' + l] = F.alt(l).value;
  }
  return JSON.stringify(o);
}

function isDirty() {
  return currentView === 'editor' && (snapshot() !== ed.baseline || coverPending() || ed.coverRemoved);
}

function fillForm(post) {
  const p = isObj(post) ? post : {};
  const pick = (k, l) => (isObj(p[k]) ? str(p[k][l]) : '');
  for (const l of LANGS) {
    F.title(l).value = pick('title', l);
    F.summary(l).value = pick('summary', l);
    setEditorMarkdown(F.body(l), pick('body', l));
    F.alt(l).value = pick('cover_alt', l);
  }
  F.slug().value = validSlug(p.slug) ? p.slug : '';
  F.author().value = str(p.author) || 'Orvix';
}

function clearCover() {
  if (ed.cover && ed.cover.url) URL.revokeObjectURL(ed.cover.url);
  ed.cover = null;
}

function resetEditor(post) {
  clearCover();
  closeLinkPop(false);
  ed.original = isObj(post) ? post : null;
  ed.coverRemoved = false;
  ed.slugTouched = !!ed.original; // existing posts keep their slug
  fillForm(ed.original);
  $('f-cover').value = '';
  setCoverMeta('');
  setFormError('');
  for (const n of document.querySelectorAll('#ed-form [aria-invalid]')) n.removeAttribute('aria-invalid');
  setLang('en', false);
  $('ed-grid').classList.remove('show-preview');
  $('btn-preview-toggle').setAttribute('aria-expanded', 'false');
  $('btn-preview-toggle').textContent = 'Show preview';
  ed.baseline = snapshot();
  refreshChrome();
  updateCounters();
  updateSlugPreview();
  updateCoverView();
  schedulePreview();
}

// Heading, status pill, buttons and slug lock, from ed.original.
function refreshChrome() {
  const pub = isPublished();
  $('ed-heading').textContent = ed.original ? 'Edit post' : 'New post';
  const pill = $('ed-status');
  pill.textContent = pub ? 'Published' : 'Draft';
  pill.className = 'pill' + (pub ? ' is-published' : '');
  const live = $('ed-live');
  live.hidden = !(pub && validSlug(ed.original.slug));
  if (!live.hidden) live.href = articleUrl(ed.original.slug);
  // Saving a published post "as draft" would take it offline, so that path is
  // only offered through the explicit Unpublish button.
  $('btn-save').hidden = pub;
  $('btn-publish').textContent = pub ? 'Update' : 'Publish';
  $('btn-unpublish').hidden = !pub;
  const locked = slugLocked();
  F.slug().disabled = locked;
  $('n-slug').hidden = !locked;
}

async function openEditor(slug) {
  if (!slug) { resetEditor(null); show('editor'); F.title('en').focus(); return; }
  try {
    const post = await api('GET', '/api/posts/' + encodeURIComponent(slug));
    resetEditor(isObj(post.post) ? post.post : post); // accept {post:{...}} or the bare post
    show('editor');
  } catch (e) {
    if (e.kind === 'auth') return showSigninView();
    toast(e.status === 404 ? 'That post no longer exists.' : (e.kind === 'network' ? 'Could not reach the server.' : e.message), true);
    if (e.status === 404) loadList();
  }
}

async function leaveEditor() {
  if (isDirty()) {
    const ok = await ask('Discard unsaved changes?', 'You have changes that have not been saved. If you go back now they will be lost.', 'Discard changes', true);
    if (!ok) return;
  }
  closeLinkPop(false);
  clearCover();
  ed.baseline = '';
  show('loading');
  await loadList();
}

/* ------------------------------------------------------------------ *
 * Editor UI: tabs, counters, slug
 * ------------------------------------------------------------------ */

function setLang(lang, focus) {
  ed.lang = lang;
  closeLinkPop(false);
  for (const l of LANGS) {
    const tab = $('tab-' + l);
    const on = l === lang;
    tab.setAttribute('aria-selected', on ? 'true' : 'false');
    tab.tabIndex = on ? 0 : -1;
    $('panel-' + l).hidden = !on;
    if (on && focus) tab.focus();
  }
  schedulePreview();
}

function updateCounters() {
  for (const n of document.querySelectorAll('[data-counter]')) {
    const c = $(n.getAttribute('data-counter'));
    c.textContent = String(n.value.length);
    c.parentElement.classList.toggle('over', n.value.length >= Number(n.maxLength));
  }
  for (const l of LANGS) {
    const md = bodyMd(l);
    const w = plainWords(md);
    $('wc-' + l).textContent = w + (w === 1 ? ' word' : ' words');
    $('rt-' + l).textContent = readMinutes(md) + ' min read';
    F.body(l).classList.toggle('is-empty', !md);
  }
}

function updateSlugPreview() {
  $('slug-preview').textContent = F.slug().value || 'your-title';
}

function onEnglishTitle() {
  if (!ed.slugTouched && !slugLocked()) {
    F.slug().value = slugify(F.title('en').value);
    updateSlugPreview();
  }
}

function onSlugInput() {
  const f = F.slug();
  const cleaned = softSlug(f.value);
  if (cleaned !== f.value) f.value = cleaned;
  // Emptying the field hands control back to the automatic slug.
  ed.slugTouched = f.value !== '';
  if (!ed.slugTouched) f.value = slugify(F.title('en').value);
  f.removeAttribute('aria-invalid');
  updateSlugPreview();
}

/* ------------------------------------------------------------------ *
 * Rich text editor
 *
 * Bold, italic and link creation use execCommand (reliable for inline
 * marks). Block changes (paragraph, headings, quote, lists) are done by hand
 * on the editor's top-level blocks so the structure always stays inside the
 * markdown subset. Saved output always goes through domToMarkdown().
 * ------------------------------------------------------------------ */

const TOOLS = [
  { cmd: 'p', label: 'Normal', title: 'Paragraph (normal text)', toggle: true },
  { cmd: 'h2', label: 'Heading', title: 'Heading', toggle: true },
  { cmd: 'h3', label: 'Subheading', title: 'Subheading', toggle: true },
  { sep: true },
  { cmd: 'bold', label: 'B', title: 'Bold (Ctrl+B)', cls: 'b', toggle: true },
  { cmd: 'italic', label: 'I', title: 'Italic (Ctrl+I)', cls: 'i', toggle: true },
  { cmd: 'link', label: 'Link', title: 'Link (Ctrl+K)', toggle: true },
  { sep: true },
  { cmd: 'ul', label: '• List', title: 'Bulleted list', toggle: true },
  { cmd: 'ol', label: '1. List', title: 'Numbered list', toggle: true },
  { cmd: 'blockquote', label: '“ Quote', title: 'Quote', toggle: true },
  { sep: true },
  { cmd: 'clear', label: 'Clear', title: 'Clear formatting' },
];

const lastRange = new WeakMap(); // editor -> last selection inside it

function setEditorMarkdown(root, md) {
  root.innerHTML = renderMarkdown(md) || '<p><br></p>'; // renderer output is escaped
  tidyEditor(root);
}

function editorOf(node) {
  const e = node && (node.nodeType === 1 ? node : node.parentNode);
  return e && e.closest ? e.closest('.rte') : null;
}

function currentRange(root) {
  const sel = window.getSelection();
  if (sel && sel.rangeCount) {
    const r = sel.getRangeAt(0);
    if (root.contains(r.commonAncestorContainer)) return r;
  }
  return null;
}

// Focus the editor and put back its last selection (toolbar clicks and the
// link box take focus away).
function restoreSelection(root) {
  // A live selection inside the editor always wins: keyboard shortcuts and
  // toolbar clicks (mousedown is prevented) keep it, and the remembered range
  // can lag behind fast typing, which put text in the wrong place.
  if (currentRange(root)) { root.focus({ preventScroll: true }); return; }
  root.focus({ preventScroll: true });
  const r = lastRange.get(root);
  const sel = window.getSelection();
  if (r && root.contains(r.startContainer) && root.contains(r.endContainer)) {
    sel.removeAllRanges();
    sel.addRange(r);
  } else if (!currentRange(root)) {
    const end = document.createRange();
    end.selectNodeContents(root);
    end.collapse(false);
    sel.removeAllRanges();
    sel.addRange(end);
  }
}

function unwrap(n) {
  const p = n.parentNode;
  while (n.firstChild) p.insertBefore(n.firstChild, n);
  p.removeChild(n);
}

// Strip what execCommand / paste leave behind: spans, fonts, styles,
// classes, every attribute except href on links. Keeps the caret markers.
function tidyEditor(root) {
  for (const n of [...root.querySelectorAll('*')]) {
    const tag = tagName(n);
    if (n.hasAttribute('data-m')) continue;
    if (SKIP_TAGS.has(tag)) { n.remove(); continue; }
    if (tag === 'SPAN' || tag === 'FONT' || tag === 'U' || tag === 'S' || tag === 'SUB' || tag === 'SUP' || tag === 'CODE' || tag === 'MARK') { unwrap(n); continue; }
    for (const a of [...n.attributes]) {
      if (!(tag === 'A' && a.name === 'href')) n.removeAttribute(a.name);
    }
    if (tag === 'A' && !linkAllowed((n.getAttribute('href') || '').trim()) && !hrefRenderable(n.getAttribute('href') || '')) unwrap(n);
  }
  ensureBlocks(root);
}

// Every direct child of the editor must be a block; wrap stray inline runs.
function ensureBlocks(root) {
  let run = [];
  const wrap = () => {
    if (run.some((n) => n.nodeType !== 3 || n.nodeValue.trim())) {
      const p = document.createElement('p');
      run[0].parentNode.insertBefore(p, run[0]);
      for (const n of run) p.appendChild(n);
    } else {
      for (const n of run) n.remove();
    }
    run = [];
  };
  for (const n of [...root.childNodes]) {
    if (isBlockEl(n)) { if (run.length) wrap(); } else run.push(n);
  }
  if (run.length) wrap();
  if (!root.firstElementChild) root.innerHTML = '<p><br></p>';
}

// Marker spans keep the selection across DOM surgery.
function placeMarkers(range) {
  const s = document.createElement('span');
  s.setAttribute('data-m', 's');
  if (range.collapsed) { range.insertNode(s); return [s, s]; }
  const e = document.createElement('span');
  e.setAttribute('data-m', 'e');
  const r2 = range.cloneRange(); r2.collapse(false); r2.insertNode(e);
  const r1 = range.cloneRange(); r1.collapse(true); r1.insertNode(s);
  return [s, e];
}

function restoreMarkers([s, e]) {
  const r = document.createRange();
  r.setStartBefore(s);
  r.setEndBefore(e);
  s.remove();
  if (e !== s) e.remove();
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
}

function topBlocks(root, range) {
  return [...root.children].filter((c) => range.intersectsNode(c));
}

// A "unit" is the inline content of one line-level block (a paragraph, a
// heading, one list item, one paragraph of a quote).
function collectUnits(b, units) {
  const tag = tagName(b);
  if (tag === 'UL' || tag === 'OL') {
    for (const li of b.querySelectorAll('li')) {
      units.push([...li.childNodes].filter((c) => tagName(c) !== 'UL' && tagName(c) !== 'OL'));
    }
    return;
  }
  if ([...b.children].some(isBlockEl)) {
    let run = [];
    for (const c of [...b.childNodes]) {
      if (isBlockEl(c)) { if (run.length) { units.push(run); run = []; } collectUnits(c, units); } else run.push(c);
    }
    if (run.length) units.push(run);
    return;
  }
  units.push([...b.childNodes]);
}

function fillBlock(elm, nodes) {
  for (const n of nodes) elm.appendChild(n);
  if (!elm.textContent.trim() && !elm.querySelector('br')) elm.appendChild(document.createElement('br'));
  return elm;
}

// type: 'p' | 'h2' | 'h3' | 'blockquote' | 'ul' | 'ol'. Applying the type the
// selection already has turns it back into normal paragraphs.
function applyBlock(root, type) {
  ensureBlocks(root);
  const range = currentRange(root);
  if (!range) return;
  const blocks = topBlocks(root, range);
  if (!blocks.length) return;
  const markers = placeMarkers(range);
  const target = type !== 'p' && blocks.every((b) => tagName(b) === type.toUpperCase()) ? 'p' : type;
  const units = [];
  for (const b of blocks) collectUnits(b, units);
  const frag = document.createDocumentFragment();
  if (target === 'ul' || target === 'ol' || target === 'blockquote') {
    const wrapper = document.createElement(target);
    const inner = target === 'blockquote' ? 'p' : 'li';
    for (const u of units) wrapper.appendChild(fillBlock(document.createElement(inner), u));
    frag.appendChild(wrapper);
  } else {
    for (const u of units) frag.appendChild(fillBlock(document.createElement(target), u));
  }
  root.insertBefore(frag, blocks[0]);
  for (const b of blocks) b.remove();
  restoreMarkers(markers);
  afterEdit(root);
}

function afterEdit(root) {
  root.dispatchEvent(new Event('input', { bubbles: true }));
  updateToolbarState();
}

function runTool(root, cmd) {
  if (cmd === 'link') return openLinkPop(root);
  restoreSelection(root);
  if (cmd === 'bold' || cmd === 'italic') {
    document.execCommand(cmd, false, null);
    tidyEditor(root);
    return afterEdit(root);
  }
  if (cmd === 'clear') {
    document.execCommand('removeFormat', false, null);
    document.execCommand('unlink', false, null);
    tidyEditor(root);
    // Strip any remaining bold/italic in the selection (removeFormat misses some).
    const r = currentRange(root);
    if (r) {
      for (const n of [...root.querySelectorAll('strong,b,em,i')]) if (r.intersectsNode(n) && !r.collapsed) unwrap(n);
    }
    // Back to a plain paragraph, unless it already is one.
    return applyBlock(root, 'p');
  }
  applyBlock(root, cmd);
}

function buildToolbars() {
  for (const bar of document.querySelectorAll('.toolbar')) {
    const root = $(bar.getAttribute('data-target'));
    for (const t of TOOLS) {
      if (t.sep) { bar.appendChild(el('span', { class: 'tb-sep', 'aria-hidden': 'true' })); continue; }
      const b = el('button', { type: 'button', class: 'tb' + (t.cls ? ' ' + t.cls : ''), 'data-cmd': t.cmd, 'aria-label': t.title, title: t.title }, t.label);
      if (t.toggle) b.setAttribute('aria-pressed', 'false');
      // Keep the editor's selection when the button is clicked with a mouse.
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => runTool(root, t.cmd));
      bar.appendChild(b);
    }
  }
}

// aria-pressed on the toolbar of the editor that holds the selection.
function updateToolbarState() {
  const sel = window.getSelection();
  const node = sel && sel.rangeCount ? sel.getRangeAt(0).startContainer : null;
  const root = editorOf(node);
  if (!root) return;
  lastRange.set(root, sel.getRangeAt(0).cloneRange());
  const elx = node.nodeType === 1 ? node : node.parentNode;
  const within = (q) => { const m = elx.closest(q); return !!m && root.contains(m) && m !== root; };
  let top = elx;
  while (top && top.parentNode !== root && top !== root) top = top.parentNode;
  const block = top && top !== root ? tagName(top) : 'P';
  const state = {
    p: block === 'P' || block === 'DIV',
    h2: block === 'H2', h3: block === 'H3',
    ul: block === 'UL', ol: block === 'OL', blockquote: block === 'BLOCKQUOTE',
    bold: within('strong,b'), italic: within('em,i'), link: within('a'),
  };
  const bar = document.querySelector('.toolbar[data-target="' + root.id + '"]');
  for (const b of bar.querySelectorAll('[aria-pressed]')) {
    b.setAttribute('aria-pressed', state[b.getAttribute('data-cmd')] ? 'true' : 'false');
  }
}

/* --- link popover --- */

const linkState = { root: null, range: null, anchor: null };

function anchorAt(root, range) {
  const n = range.startContainer;
  const e = n.nodeType === 1 ? n : n.parentNode;
  const a = e && e.closest('a');
  return a && root.contains(a) ? a : null;
}

function openLinkPop(root) {
  restoreSelection(root);
  const range = currentRange(root);
  if (!range) return;
  linkState.root = root;
  linkState.range = range.cloneRange();
  linkState.anchor = anchorAt(root, range);
  const pop = $('link-pop');
  root.parentNode.insertBefore(pop, root); // between toolbar and editor
  $('link-url').value = linkState.anchor ? (linkState.anchor.getAttribute('href') || '') : '';
  $('link-remove').hidden = !linkState.anchor && !range.toString();
  $('link-err').hidden = true;
  $('link-url').removeAttribute('aria-invalid');
  pop.hidden = false;
  $('link-url').focus();
  $('link-url').select();
}

function closeLinkPop(refocus) {
  const pop = $('link-pop');
  if (pop.hidden) return;
  pop.hidden = true;
  const root = linkState.root;
  if (refocus && root) {
    if (linkState.range) lastRange.set(root, linkState.range);
    restoreSelection(root);
  }
  linkState.root = linkState.range = linkState.anchor = null;
}

function applyLink() {
  const url = $('link-url').value.trim();
  if (!linkAllowed(url)) {
    const err = $('link-err');
    err.textContent = 'Use a full address starting with https:// (or http://), or a page on this site starting with /.';
    err.hidden = false;
    $('link-url').setAttribute('aria-invalid', 'true');
    $('link-url').focus();
    return;
  }
  const { root, range, anchor } = linkState;
  if (!root) return;
  root.focus({ preventScroll: true });
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  if (anchor && root.contains(anchor)) {
    anchor.setAttribute('href', url);
  } else if (range.collapsed) {
    // No text selected: insert the address itself as the link text.
    const a = document.createElement('a');
    a.setAttribute('href', url);
    a.textContent = url;
    range.insertNode(a);
    const after = document.createRange();
    after.setStartAfter(a);
    after.collapse(true);
    sel.removeAllRanges();
    sel.addRange(after);
  } else {
    document.execCommand('createLink', false, url);
  }
  tidyEditor(root);
  $('link-pop').hidden = true;
  linkState.root = linkState.range = linkState.anchor = null;
  afterEdit(root);
}

function removeLink() {
  const { root, range, anchor } = linkState;
  if (!root) return;
  root.focus({ preventScroll: true });
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  if (anchor && root.contains(anchor)) unwrap(anchor);
  else document.execCommand('unlink', false, null);
  $('link-pop').hidden = true;
  linkState.root = linkState.range = linkState.anchor = null;
  afterEdit(root);
}

/* --- paste --- */

function onPaste(e) {
  const root = e.currentTarget;
  const dt = e.clipboardData;
  if (!dt) return;
  e.preventDefault();
  const html = dt.getData('text/html');
  const text = dt.getData('text/plain');
  let clean = '';
  if (html) {
    const box = sanitizePastedHtml(html);
    if (box.textContent.trim()) clean = box.innerHTML; // serialised from our own clean nodes
  }
  if (!clean) {
    if (!text) return;
    if (!/\n/.test(text.trim())) {
      document.execCommand('insertText', false, text.replace(/\s+/g, ' '));
      tidyEditor(root);
      return afterEdit(root);
    }
    clean = textToHtml(text);
  }
  document.execCommand('insertHTML', false, clean);
  tidyEditor(root);
  afterEdit(root);
}

/* ---- Markdown files: import into the editor, download from it -------------
   Editors normally never see markdown; these exist so posts written elsewhere
   (or kept as files) can come in and go out. An imported file is rendered with
   the same safe renderer as the preview, so nothing outside the supported
   formatting survives. Optional front matter (--- title: / summary: / author: ---)
   and a leading "# Title" line fill empty fields. */
const MD_MAX_BYTES = 200 * 1024;

function parseMarkdownFile(text) {
  let src = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const meta = {};
  const fm = src.match(/^---\n([\s\S]*?)\n---\n?/);
  if (fm) {
    for (const line of fm[1].split('\n')) {
      const m = line.match(/^\s*(title|summary|description|author)\s*:\s*(.*?)\s*$/i);
      if (m) meta[m[1].toLowerCase() === 'description' ? 'summary' : m[1].toLowerCase()] = m[2].replace(/^["']|["']$/g, '');
    }
    src = src.slice(fm[0].length);
  }
  const h1 = src.match(/^\s*# (.+)\n?/);
  if (h1) {
    if (!meta.title) meta.title = h1[1].trim();
    src = src.slice(h1[0].length);
  }
  // the article format has no top-level heading: any other "# x" becomes a heading
  src = src.replace(/^# /gm, '## ');
  return { meta, body: src.trim() };
}

function wireMarkdownTools() {
  for (const l of LANGS) {
    const input = document.querySelector(`[data-md-file="${l}"]`);
    const imp = document.querySelector(`[data-md-import="${l}"]`);
    const exp = document.querySelector(`[data-md-export="${l}"]`);
    if (!input || !imp || !exp) continue;
    imp.addEventListener('click', () => input.click());
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      input.value = '';
      if (!file) return;
      if (file.size > MD_MAX_BYTES) return toast('That file is too large to import (200 KB at most).', true);
      let text;
      try { text = await file.text(); } catch (e) { return toast('That file could not be read.', true); }
      const { meta, body } = parseMarkdownFile(text);
      if (bodyMd(l) && !(await ask('Replace the article text?', 'The imported file will replace what is in the editor now.', 'Replace', true))) return;
      F.body(l).innerHTML = renderMarkdown(body) || '<p><br></p>';
      if (meta.title && !F.title(l).value) F.title(l).value = meta.title.slice(0, 120);
      if (meta.summary && !F.summary(l).value) F.summary(l).value = meta.summary.slice(0, 300);
      if (l === 'en' && meta.author && (!F.author().value || F.author().value === 'Orvix')) F.author().value = meta.author.slice(0, 80);
      F.title(l).dispatchEvent(new Event('input', { bubbles: true }));
      F.body(l).dispatchEvent(new Event('input', { bubbles: true }));
      toast('Imported "' + file.name.slice(0, 80) + '".');
    });
    exp.addEventListener('click', () => {
      const title = F.title(l).value.trim();
      const md = (title ? '# ' + title + '\n\n' : '') + bodyMd(l) + '\n';
      const url = URL.createObjectURL(new Blob([md], { type: 'text/markdown;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = (F.slug().value || 'article') + (l === 'ar' ? '-ar' : '') + '.md';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }
}

function wireEditors() {
  wireMarkdownTools();
  try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch (e) { /* older browsers */ }
  try { document.execCommand('styleWithCSS', false, false); } catch (e) { /* ignore */ }
  buildToolbars();
  for (const l of LANGS) {
    const root = F.body(l);
    root.addEventListener('paste', onPaste);
    root.addEventListener('drop', (e) => e.preventDefault()); // no dragging HTML in
    root.addEventListener('keydown', (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'b' || k === 'i') { e.preventDefault(); runTool(root, k === 'b' ? 'bold' : 'italic'); }
      else if (k === 'k') { e.preventDefault(); openLinkPop(root); }
    });
    // Keep the structure valid after the browser's own edits (Enter, delete).
    root.addEventListener('input', () => {
      if (!root.firstElementChild || [...root.childNodes].some((n) => !isBlockEl(n) && (n.nodeType !== 3 || n.nodeValue.trim()))) {
        const r = currentRange(root);
        const m = r ? placeMarkers(r) : null;
        ensureBlocks(root);
        if (m) restoreMarkers(m);
      }
    });
  }
  document.addEventListener('selectionchange', updateToolbarState);

  $('link-apply').addEventListener('click', applyLink);
  $('link-remove').addEventListener('click', removeLink);
  $('link-cancel').addEventListener('click', () => closeLinkPop(true));
  $('link-url').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); applyLink(); }
    else if (e.key === 'Escape') { e.preventDefault(); closeLinkPop(true); }
  });
  $('link-url').addEventListener('input', () => { $('link-err').hidden = true; $('link-url').removeAttribute('aria-invalid'); });
  $('link-pop').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); closeLinkPop(true); } });
}

/* ------------------------------------------------------------------ *
 * Preview (same structure as the published article)
 * ------------------------------------------------------------------ */

let previewQueued = false;
function schedulePreview() {
  if (previewQueued) return;
  previewQueued = true;
  requestAnimationFrame(() => { previewQueued = false; renderPreview(); });
}

function renderPreview() {
  const l = ed.lang;
  const c = COPY[l];
  const pv = $('preview');
  pv.setAttribute('dir', l === 'ar' ? 'rtl' : 'ltr');
  pv.setAttribute('lang', l);
  $('preview-lang').textContent = l === 'ar' ? 'Arabic' : 'English';

  const title = F.title(l).value.trim();
  // As on the site: an empty Arabic summary falls back to the English one.
  const summary = F.summary(l).value.trim() || F.summary('en').value.trim();
  $('pv-kicker').textContent = c.label;
  $('pv-title').textContent = title || (l === 'ar' ? 'العنوان' : 'Title');
  $('pv-title').classList.toggle('placeholder', !title);
  $('pv-summary').textContent = summary || (l === 'ar' ? 'الملخص' : 'Summary');
  $('pv-summary').classList.toggle('placeholder', !summary);

  const md = bodyMd(l);
  const published = ed.original && str(ed.original.published);
  const author = F.author().value.trim() || 'Orvix';
  $('pv-meta').textContent = [niceDate(published || todayIso(), l), author, c.min(readMinutes(md))].join(' · ');

  // Cover as the banner background. src is a blob: URL we created or a
  // validated root-relative path ([A-Za-z0-9._/-] only), so it cannot break
  // out of url("...").
  const src = coverSrc();
  $('pv-banner-bg').style.backgroundImage = src ? 'url("' + src + '")' : 'none';
  $('pv-banner').classList.toggle('has-cover', !!src);

  // Safe: renderMarkdown escapes its entire input before adding its own tags.
  $('pv-body').innerHTML = renderMarkdown(md);
}

/* ------------------------------------------------------------------ *
 * Cover image: decode, downscale to 1600px, export WebP
 * ------------------------------------------------------------------ */

// Server image paths that failed to load (e.g. not deployed yet) are not retried.
const brokenSrc = new Set();

function coverSrc() {
  if (ed.cover) return ed.cover.url;
  if (ed.coverRemoved || !ed.original) return '';
  const p = safeImagePath(ed.original.cover);
  return brokenSrc.has(p) ? '' : p;
}

function setCoverMeta(msg, isErr) {
  const m = $('cover-meta');
  m.textContent = msg;
  m.classList.toggle('err', !!isErr);
}

function updateCoverView() {
  const src = coverSrc();
  const img = $('cover-img');
  img.hidden = !src;
  if (src) { if (img.getAttribute('src') !== src) img.src = src; } else img.removeAttribute('src');
  $('btn-cover-remove').hidden = !src;
  schedulePreview();
}

async function decodeImage(file) {
  if ('createImageBitmap' in window) {
    try { return await createImageBitmap(file); } catch (e) { /* fall back to <img> */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

async function handleCoverFile(file) {
  if (!file) return;
  const okTypes = ['image/jpeg', 'image/png', 'image/webp'];
  if (!okTypes.includes(file.type)) return setCoverMeta('Please choose a JPEG, PNG or WebP image.', true);
  if (file.size > MAX_INPUT_BYTES) return setCoverMeta('That file is over 15 MB. Please choose a smaller image.', true);

  setCoverMeta('Processing…');
  try {
    const src = await decodeImage(file);
    const w = src.width, h = src.height;
    if (!w || !h) throw new Error('empty');
    const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
    const cw = Math.max(1, Math.round(w * scale));
    const ch = Math.max(1, Math.round(h * scale));
    const canvas = document.createElement('canvas');
    canvas.width = cw; canvas.height = ch;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, cw, ch);
    if (src.close) src.close();

    const blob = await new Promise((res) => canvas.toBlob(res, 'image/webp', 0.82));
    // Browsers without WebP encoding silently return PNG instead.
    if (!blob || blob.type !== 'image/webp') {
      return setCoverMeta('This browser cannot convert images to WebP. Please use a current Chrome, Edge, Firefox or Safari.', true);
    }
    if (blob.size > MAX_OUTPUT_BYTES) {
      return setCoverMeta('The converted image is over 3 MB. Please choose a simpler or smaller photo.', true);
    }
    const base64 = await blobToBase64(blob);
    clearCover();
    ed.cover = { base64, url: URL.createObjectURL(blob), kb: Math.round(blob.size / 1024), uploaded: false };
    ed.coverRemoved = false;
    setCoverMeta(cw + ' × ' + ch + ' px, ' + ed.cover.kb + ' KB WebP. Uploaded when you save.');
    updateCoverView();
  } catch (e) {
    setCoverMeta('That image could not be read. Try another file.', true);
  } finally {
    $('f-cover').value = '';
  }
}

function removeCover() {
  clearCover();
  ed.coverRemoved = !!(ed.original && safeImagePath(ed.original.cover));
  setCoverMeta(ed.coverRemoved ? 'Cover will be removed when you save.' : '');
  updateCoverView();
}

/* ------------------------------------------------------------------ *
 * Validation and save
 * ------------------------------------------------------------------ */

function setFormError(msg) {
  const n = $('form-error');
  n.textContent = msg;
  n.hidden = !msg;
}

function invalid(field, lang) {
  if (lang) setLang(lang, false);
  field.setAttribute('aria-invalid', 'true');
  field.focus();
}

// Returns an error message (and focuses the field) or '' when valid.
function validate(publishing) {
  for (const n of document.querySelectorAll('#ed-form [aria-invalid]')) n.removeAttribute('aria-invalid');
  const slugField = F.slug();
  if (!slugField.disabled) {
    slugField.value = slugField.value.replace(/^-+|-+$/g, ''); // tidy a trailing '-' left while typing
    updateSlugPreview();
  }
  const v = (f) => f.value.trim();

  if (!v(F.title('en'))) { invalid(F.title('en'), 'en'); return 'An English title is needed, even for a draft.'; }
  const slug = slugField.value;
  if (!validSlug(slug)) {
    invalid(slugField);
    return 'The address must use lowercase letters, numbers and single hyphens (up to 80 characters).';
  }
  const originalSlug = ed.original ? ed.original.slug : null;
  if (slug !== originalSlug && knownSlugs.has(slug)) {
    invalid(slugField);
    return 'Another post already uses this address. Choose a different one.';
  }
  // Renaming a saved draft: the stored cover belongs to the old address, so
  // ask for the photo again. (A photo picked in this session is re-sent.)
  if (ed.original && slug !== originalSlug && safeImagePath(ed.original.cover) && !ed.cover && !ed.coverRemoved) {
    return 'You changed the address of a saved draft that has a cover photo. Please choose the cover photo again (or remove it) so it moves with the post.';
  }
  for (const l of LANGS) {
    if (F.title(l).value.length > 120) { invalid(F.title(l), l); return 'Titles can be at most 120 characters.'; }
    if (F.summary(l).value.length > 300) { invalid(F.summary(l), l); return 'Summaries can be at most 300 characters.'; }
  }
  if (!v(F.author())) F.author().value = 'Orvix';

  if (publishing) {
    if (!v(F.summary('en'))) { invalid(F.summary('en'), 'en'); return 'An English summary is needed to publish.'; }
    if (!bodyMd('en')) { invalid(F.body('en'), 'en'); return 'The English article text is needed to publish.'; }
    // Arabic is optional, but a half-written translation should not go live.
    const ar = [[F.title('ar'), v(F.title('ar'))], [F.summary('ar'), v(F.summary('ar'))], [F.body('ar'), bodyMd('ar')]];
    if (ar.some((x) => x[1])) {
      const missing = ar.find((x) => !x[1]);
      if (missing) { invalid(missing[0], 'ar'); return 'The Arabic version is incomplete: title, summary and article text are all needed to publish it (or clear the Arabic tab).'; }
    }
  }
  return '';
}

function collectPost(status) {
  const o = ed.original || {};
  const pair = (fn) => {
    const r = {};
    for (const l of LANGS) r[l] = fn(l);
    return r;
  };
  return {
    slug: F.slug().value,
    status,
    published: typeof o.published === 'string' ? o.published : null,
    updated: typeof o.updated === 'string' ? o.updated : null,
    author: F.author().value.trim() || 'Orvix',
    title: pair((l) => F.title(l).value.trim()),
    summary: pair((l) => F.summary(l).value.trim()),
    body: pair(bodyMd),
    // Server owns this; "" with no upload means "no cover".
    cover: ed.coverRemoved ? '' : (typeof o.cover === 'string' ? o.cover : ''),
    cover_alt: pair((l) => F.alt(l).value.trim()),
  };
}

function setBusy(b) {
  ed.busy = b;
  for (const id of ['btn-save', 'btn-publish', 'btn-unpublish', 'btn-back']) $(id).disabled = b;
}

// action: 'draft' | 'publish' | 'unpublish'. confirmed skips the unpublish
// question when re-run after signing in again.
async function save(action, confirmed) {
  if (ed.busy) return;
  closeLinkPop(false);
  const publishing = action === 'publish';
  const err = validate(publishing);
  setFormError(err);
  if (err) { toast(err, true); return; }

  if (action === 'unpublish' && !confirmed) {
    const ok = await ask('Unpublish this post?', 'It will be taken off the live site and kept as a draft. Its address stays reserved.', 'Unpublish', true);
    if (!ok) return;
  }

  const wasPublished = isPublished();
  const oldSlug = ed.original ? ed.original.slug : null;
  const post = collectPost(publishing ? 'published' : 'draft');
  // Upload the photo if it is new, or again if the post moved to a new slug.
  const sendCover = !!ed.cover && (!ed.cover.uploaded || post.slug !== oldSlug);
  const payload = {
    post,
    cover_upload: sendCover ? { type: 'image/webp', data: ed.cover.base64 } : null,
  };

  setBusy(true);
  try {
    const res = await api('PUT', '/api/posts/' + encodeURIComponent(post.slug), payload);
    // Prefer the server's copy (it sets published/updated/cover).
    const saved = isObj(res.post) ? res.post : post;
    if (!validSlug(saved.slug)) saved.slug = post.slug;

    // A saved draft moved to a new address: remove the old copy.
    if (oldSlug && oldSlug !== saved.slug && validSlug(oldSlug)) {
      try {
        await api('DELETE', '/api/posts/' + encodeURIComponent(oldSlug));
        knownSlugs.delete(oldSlug);
      } catch (e) {
        toast('Saved under the new address, but the old draft "' + oldSlug + '" could not be removed. Delete it from the list.', true);
      }
    }
    knownSlugs.add(saved.slug);

    // Keep showing the local copy of a just-uploaded photo: the server path
    // may not be deployed yet.
    if (ed.cover) ed.cover.uploaded = true;
    ed.coverRemoved = false;
    ed.original = saved;
    ed.slugTouched = true;
    F.slug().value = saved.slug;
    ed.baseline = snapshot();
    refreshChrome();
    updateSlugPreview();
    updateCoverView();
    setCoverMeta('');

    if (action === 'publish') toast(wasPublished ? 'Updated. Live in about a minute.' : 'Published. Live in about a minute.');
    else if (action === 'unpublish') toast('Unpublished. It will disappear from the site in about a minute.');
    else toast('Draft saved');
    if (isObj(res.newsletter)) newsletterToast(res.newsletter);
  } catch (e) {
    if (e.kind === 'auth') handleAuthLoss(() => save(action, true));
    else if (e.kind === 'network') toast('Could not reach the server, so nothing was saved. Check your connection and try again.', true);
    else { setFormError(e.message); toast(e.message, true); }
  } finally {
    setBusy(false);
  }
}

/* ------------------------------------------------------------------ *
 * Wiring
 * ------------------------------------------------------------------ */

function wire() {
  wireEditors();

  $('error-retry').addEventListener('click', () => start());
  $('btn-new').addEventListener('click', () => openEditor(null));
  $('btn-back').addEventListener('click', leaveEditor);
  $('btn-save').addEventListener('click', () => save('draft'));
  $('btn-publish').addEventListener('click', () => save('publish'));
  $('btn-unpublish').addEventListener('click', () => save('unpublish'));
  $('ed-form').addEventListener('submit', (e) => e.preventDefault());

  // Sign-in / out
  $('signin-form').addEventListener('submit', submitSignin);
  $('signin-again').addEventListener('click', () => { resetSignin(!!pendingRetry || $('auth-dlg').open); $('signin-email').focus(); });
  $('signin-retry').addEventListener('click', retryAfterSignin);
  $('signin-close').addEventListener('click', () => $('auth-dlg').close());
  $('btn-signout').addEventListener('click', signOut);
  $('auth-dlg').addEventListener('close', () => {
    // Put the sign-in box back in its page slot.
    if ($('signin-box').parentNode !== $('signin-home')) $('signin-home').appendChild($('signin-box'));
  });

  // Tabs: click, plus arrow / Home / End keys (roving tabindex).
  for (const l of LANGS) {
    const tab = $('tab-' + l);
    tab.addEventListener('click', () => setLang(l, false));
    tab.addEventListener('keydown', (e) => {
      const i = LANGS.indexOf(ed.lang);
      let next = null;
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') next = LANGS[(i + 1) % LANGS.length];
      else if (e.key === 'Home') next = LANGS[0];
      else if (e.key === 'End') next = LANGS[LANGS.length - 1];
      if (next) { e.preventDefault(); setLang(next, true); }
    });
  }

  // Any edit: counters, preview, clear error marks.
  $('ed-form').addEventListener('input', (e) => {
    const t = e.target;
    const field = t && t.closest ? (t.closest('.rte') || t) : t;
    if (field && field.removeAttribute) field.removeAttribute('aria-invalid');
    updateCounters();
    schedulePreview();
  });
  F.title('en').addEventListener('input', onEnglishTitle);
  F.slug().addEventListener('input', onSlugInput);

  // Mobile preview toggle.
  $('btn-preview-toggle').addEventListener('click', () => {
    const grid = $('ed-grid');
    const on = !grid.classList.contains('show-preview');
    grid.classList.toggle('show-preview', on);
    $('btn-preview-toggle').setAttribute('aria-expanded', on ? 'true' : 'false');
    $('btn-preview-toggle').textContent = on ? 'Back to editing' : 'Show preview';
    if (on) renderPreview();
  });

  // Cover: file input and drag & drop.
  $('f-cover').addEventListener('change', (e) => handleCoverFile(e.target.files && e.target.files[0]));
  $('btn-cover-remove').addEventListener('click', removeCover);
  const drop = $('drop');
  ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    drop.classList.add('over');
  }));
  ['dragleave', 'dragend'].forEach((t) => drop.addEventListener(t, (e) => {
    if (!drop.contains(e.relatedTarget)) drop.classList.remove('over');
  }));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    handleCoverFile(f);
  });
  // A photo dropped just outside the zone must not navigate away from the editor.
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  // Hide broken server cover images (e.g. not deployed yet).
  $('cover-img').addEventListener('error', (e) => {
    const src = e.target.getAttribute('src');
    if (src && !src.startsWith('blob:')) { brokenSrc.add(src); updateCoverView(); }
  });

  // Ctrl/Cmd+S saves (draft, or update when published).
  document.addEventListener('keydown', (e) => {
    if (currentView === 'editor' && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      save(isPublished() ? 'publish' : 'draft');
    }
  });

  // Warn before closing / reloading the tab with unsaved work.
  window.addEventListener('beforeunload', (e) => {
    if (isDirty()) { e.preventDefault(); e.returnValue = ''; }
  });

  // Arriving from an expired / used sign-in link: say so, then clean the URL.
  const q = new URLSearchParams(location.search);
  if (q.get('signin') === 'expired') $('signin-expired').hidden = false;
  if (location.search) history.replaceState(null, '', location.pathname + location.hash);
}

wire();
start();
