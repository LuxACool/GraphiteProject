/* ============================================================
   MARKDOWN + KATEX RENDERER
   One rendering pipeline for Notes, split preview, cards and AI UI.
   Markdown is parsed once, sanitized once, then KaTeX renders math
   in the resulting DOM. This avoids the old double-render pipeline.
   ============================================================ */
if (window.marked && marked.setOptions) {
  try { marked.setOptions({ gfm: true, breaks: true, headerIds: false, mangle: false }); } catch (e) {}
}

(function initMarkdownRenderer() {
  if (window.marked && typeof marked.parse === 'function' && !window._graphiteMarkedParse) {
    window._graphiteMarkedParse = marked.parse.bind(marked);
  }
})();

function renderMarkdownWithMath(source, target) {
  const text = String(source == null ? '' : source);
  let html = '';

  try {
    html = window._graphiteMarkedParse
      ? window._graphiteMarkedParse(text)
      : (window.marked && typeof marked.parse === 'function' ? marked.parse(text) : escapeHTML(text));
  } catch (err) {
    console.warn('Markdown render failed:', err);
    html = escapeHTML(text);
  }

  if (window.DOMPurify) {
    html = DOMPurify.sanitize(html, {
      ADD_ATTR: ['target', 'rel', 'data-wiki-title']
    });
  }

  // Use a real DOM node so every consumer gets exactly the same Markdown →
  // sanitized HTML → KaTeX pipeline. KaTeX auto-render intentionally ignores
  // code/pre blocks, so dollar signs inside code are never mistaken for math.
  const host = target || document.createElement('div');
  host.innerHTML = html;

  if (window.renderMathInElement) {
    try {
      renderMathInElement(host, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '\\[', right: '\\]', display: true },
          { left: '$', right: '$', display: false },
          { left: '\\(', right: '\\)', display: false }
        ],
        throwOnError: false,
        strict: 'ignore'
      });
    } catch (err) {
      console.warn('KaTeX render failed:', err);
    }
  }

  return target ? target.innerHTML : host.innerHTML;
}

// Backwards-compatible helper for code that previously expected a Markdown
// string with LaTeX rendered. New code should prefer renderMarkdownWithMath.
function renderLatexMath(text) {
  return renderMarkdownWithMath(text);
}

// Deliberately do NOT override marked.parse globally. Doing so used to make
// every Markdown consumer run through a second, incompatible LaTeX parser.

window.escapeHTML = window.escapeHTML || function (str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

function updateHoverDrawKey(val) {
    if (!val || val.length === 0) return;
    const key = val.slice(-1).toLowerCase();
    state.settings.hoverDrawKey = key;
    const el = document.getElementById('setting-hover-draw-key');
    if (el) el.value = key.toUpperCase();
    const refKbd = document.getElementById('shortcuts-hover-draw-key');
    if (refKbd) refKbd.textContent = key.toUpperCase();
    saveDataToDB();
    toast('Hover-draw key set to: ' + key.toUpperCase());
}

/* Returns the currently active note textarea (write tab or split tab) */
function _mdTa() {
  const split = document.getElementById('split-body-raw');
  if (split && split.offsetParent !== null) return split;
  return document.getElementById('note-body-raw');
}

function mdWrap(before, after) {
  const ta = _mdTa(); if (!ta) return;
  const s = ta.selectionStart, e = ta.selectionEnd;
  const sel = ta.value.slice(s, e);
  ta.value = ta.value.slice(0, s) + before + sel + after + ta.value.slice(e);
  ta.focus();
  ta.selectionStart = s + before.length;
  ta.selectionEnd = s + before.length + sel.length;
  if (typeof saveNotes === 'function') saveNotes();
  if (typeof updateLivePreview === 'function') updateLivePreview();
}

function mdLinePrefix(prefix) {
  const ta = _mdTa(); if (!ta) return;
  const v = ta.value;
  const s = ta.selectionStart, e = ta.selectionEnd;
  const lineStart = v.lastIndexOf('\n', s - 1) + 1;
  const lineEnd = v.indexOf('\n', e); const realEnd = lineEnd === -1 ? v.length : lineEnd;
  const block = v.slice(lineStart, realEnd);
  const newBlock = block.split('\n').map(l => prefix + l).join('\n');
  ta.value = v.slice(0, lineStart) + newBlock + v.slice(realEnd);
  ta.focus();
  ta.selectionStart = lineStart;
  ta.selectionEnd = lineStart + newBlock.length;
  if (typeof saveNotes === 'function') saveNotes();
  if (typeof updateLivePreview === 'function') updateLivePreview();
}

function mdInsertAtCursor(text) {
  const ta = _mdTa(); if (!ta) return;
  const s = ta.selectionStart, e = ta.selectionEnd;
  ta.value = ta.value.slice(0, s) + text + ta.value.slice(e);
  ta.focus();
  ta.selectionStart = ta.selectionEnd = s + text.length;
  if (typeof saveNotes === 'function') saveNotes();
  if (typeof updateLivePreview === 'function') updateLivePreview();
}

async function mdInsertLink() {
  const ta = _mdTa(); if (!ta) return;
  const s = ta.selectionStart, e = ta.selectionEnd;
  const sel = ta.value.slice(s, e) || 'link text';
  const result = await showModal({
    title: 'Insert link', type: 'form',
    fields: [{ id: 'url', label: 'URL', type: 'text', defaultValue: 'https://' }]
  });
  const url = result?.url?.trim();
  if (!url) return;
  const snippet = '[' + sel + '](' + url + ')';
  ta.value = ta.value.slice(0, s) + snippet + ta.value.slice(e);
  ta.focus();
  ta.selectionStart = ta.selectionEnd = s + snippet.length;
  if (typeof saveNotes === 'function') saveNotes();
  if (typeof updateLivePreview === 'function') updateLivePreview();
}

function mdInsertTable() {
  mdInsertAtCursor('\n\n| Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n| A | B | C |\n| D | E | F |\n\n');
}

document.addEventListener('keydown', function(e) {
  const ta = _mdTa();
  if (!ta || document.activeElement !== ta) return;
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
    const k = e.key.toLowerCase();
    if (k === 'b') { e.preventDefault(); mdWrap('**','**'); }
    else if (k === 'i') { e.preventDefault(); mdWrap('*','*'); }
    else if (k === 'k') { e.preventDefault(); mdInsertLink(); }
  }
});
