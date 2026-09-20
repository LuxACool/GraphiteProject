/* ============================================================
   FEATURE: FOCUS-AWARE WIKI LINKING
   ============================================================ */




// Extract meaningful keywords from text (stopword-filtered). These are shared
// with the tutor's local retrieval step, so a question is matched to the notes
// that actually discuss it rather than simply taking the first notes saved.
function extractKeywords(text) {
    const stopWords = new Set([
        'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'can', 'do', 'does',
        'for', 'from', 'how', 'i', 'in', 'is', 'it', 'me', 'my', 'of', 'on',
        'or', 'please', 'that', 'the', 'this', 'to', 'was', 'what', 'when',
        'where', 'which', 'who', 'why', 'with', 'would', 'you', 'your'
    ]);
    return (String(text || '').toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) || [])
        .filter(word => word.length > 1 && !stopWords.has(word))
        .reduce((keywords, word) => {
            keywords[word] = (keywords[word] || 0) + 1;
            return keywords;
        }, {});
}

// Score title, tags, and body separately so a matching title is preferred,
// while still allowing details mentioned only in a note body to be found.
function scoreNoteRelevance(note, keywords) {
    if (!note || !keywords || !Object.keys(keywords).length) return 0;
    const title = String(note.title || '').toLowerCase();
    const tags = String(note.tags || '').toLowerCase();
    const body = String(note.body || '').toLowerCase();
    let score = 0;

    Object.entries(keywords).forEach(([word, weight]) => {
        // extractKeywords only returns letters, numbers, apostrophes, and
        // hyphens, so each token is safe to use directly in this expression.
        const matches = value => (value.match(new RegExp(`\\b${word}\\b`, 'giu')) || []).length;
        score += matches(title) * 8 * weight;
        score += matches(tags) * 4 * weight;
        score += Math.min(matches(body), 6) * weight;
    });
    return score;
}



function insertWikiLink(title) {
    const ta = document.getElementById('note-body-raw');
    if (!ta) return;
    const pos = ta.selectionStart;
    ta.value = ta.value.substring(0, pos) + '[[' + title + ']]' + ta.value.substring(pos);
    ta.selectionStart = ta.selectionEnd = pos + title.length + 4;
    ta.focus();
    saveNotes();
    updateLivePreview();
    refreshFocusSuggestions();
    toast(`Linked [[${title}]]`);
}

/* ──────────────────────────────────────────────────────────────
   FEATURE: INLINE WIKI-LINK SUGGESTION POPUP
   As the user types a word in the editor, check if it partially
   matches any note title in the vault and show a subtle inline
   suggestion popup near the cursor.
────────────────────────────────────────────────────────────── */
let _wikiSuggestTimer = null;
function _getWordAtCursor(ta) {
    const pos = ta.selectionStart;
    const text = ta.value;
    let start = pos;
    while (start > 0 && /\S/.test(text[start - 1]) && text[start - 1] !== '[') start--;
    const word = text.slice(start, pos);
    return { word, start };
}

function checkWikiLinkSuggestion() {
    clearTimeout(_wikiSuggestTimer);
    _wikiSuggestTimer = setTimeout(() => {
        const ta = document.getElementById('note-body-raw');
        const popup = document.getElementById('wiki-suggest-popup');
        if (!ta || !popup || document.activeElement !== ta) { if (popup) popup.classList.add('hidden'); return; }

        const { word } = _getWordAtCursor(ta);
        if (!word || word.length < 3) { popup.classList.add('hidden'); return; }

        const wsNotes = (state.notes || []).filter(n => n.workspaceId === state.activeWorkspace && n.id !== state.currentNoteId);
        const matches = wsNotes.filter(n => {
            const t = (n.title || '').toLowerCase();
            return t.includes(word.toLowerCase()) && t !== word.toLowerCase();
        }).slice(0, 5);

        if (!matches.length) { popup.classList.add('hidden'); return; }

        // Position popup below textarea using caret coordinates approximation
        const lineH = 20;
        const lines = ta.value.substring(0, ta.selectionStart).split('\n');
        const lineNum = lines.length;
        const rect = ta.getBoundingClientRect();
        const approxTop = rect.top + lineNum * lineH + 8;
        const approxLeft = rect.left + 16;

        popup.style.top = Math.min(approxTop, window.innerHeight - 200) + 'px';
        popup.style.left = Math.min(approxLeft, window.innerWidth - 280) + 'px';

        popup.innerHTML = `
            <div class="px-3 py-1.5 border-b border-borderDark flex items-center justify-between">
                <span class="text-[10px] font-bold text-textMuted uppercase tracking-wider">Wiki Links</span>
                <span class="text-[9px] text-textMuted opacity-60">matches "${word}"</span>
            </div>
            ${matches.map(n => `
                <div class="px-3 py-2 hover:bg-accent/10 cursor-pointer flex items-center gap-2 group"
                    onclick="insertWikiLinkAtCursor('${n.title.replace(/'/g, "\\'")}'); document.getElementById('wiki-suggest-popup').classList.add('hidden');">
                    <span class="w-1.5 h-1.5 rounded-full bg-accent shrink-0 opacity-60 group-hover:opacity-100"></span>
                    <span class="text-sm text-textMain truncate">${n.title}</span>
                    <span class="text-[9px] text-accent ml-auto opacity-0 group-hover:opacity-100">[[link]]</span>
                </div>`).join('')}
        `;
        popup.classList.remove('hidden');
    }, 280);
}

function insertWikiLinkAtCursor(title) {
    const ta = document.getElementById('note-body-raw');
    if (!ta) return;
    const { word, start } = _getWordAtCursor(ta);
    const end = ta.selectionStart;
    ta.value = ta.value.slice(0, start) + '[[' + title + ']]' + ta.value.slice(end);
    ta.selectionStart = ta.selectionEnd = start + title.length + 4;
    ta.focus();
    saveNotes();
    updateLivePreview();
    toast(`Linked [[${title}]]`);
}

// Hide popup on outside click / escape
document.addEventListener('click', (e) => {
    const popup = document.getElementById('wiki-suggest-popup');
    if (popup && !popup.contains(e.target)) popup.classList.add('hidden');
});
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const popup = document.getElementById('wiki-suggest-popup');
        if (popup) popup.classList.add('hidden');
    }
});
