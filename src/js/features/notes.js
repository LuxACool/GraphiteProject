/* --- NOTES, FULL-TEXT SEARCH, AUTOCOMPLETE, SHORTCUTS --- */
let undoStack = [];
let redoStack = [];
let snapshotTimeout = null;

function takeSnapshot(body) {
    if (undoStack.length === 0 || undoStack[undoStack.length - 1] !== body) {
        undoStack.push(body);
        if (undoStack.length > 30) undoStack.shift(); 
        redoStack = []; 
    }
}

function createNewNote() {
    const newNote = { id: Date.now().toString(), title: '', body: '', tags: '', timestamp: new Date().toLocaleDateString(), workspaceId: state.activeWorkspace };
    state.notes.unshift(newNote); saveDataToDB(); renderNotesList(); loadNoteIntoEditor(newNote.id);
}

// FEATURE: Autocomplete Engine & Shortcuts
let focusSuggDebounce = null;
let _previewDebounce = null;
function handleEditorInput(e) {
    saveNotes(); updateWordCount();
    // Debounce preview rendering — was firing on every keystroke causing layout thrash
    clearTimeout(_previewDebounce);
    _previewDebounce = setTimeout(() => updateLivePreview(), 300);
    // Debounced focus-aware suggestion refresh
    if (isFocusMode && state.settings.focusAwareEnabled) {
        clearTimeout(focusSuggDebounce);
        focusSuggDebounce = setTimeout(refreshFocusSuggestions, 800);
    }

    const ta = e.target;
    const val = ta.value;
    const start = ta.selectionStart;

    // Check triggers
    const lastTwo = val.substring(start - 2, start);
    const lastOne = val.substring(start - 1, start);

    // FEATURE: extended trigger detection — `[[`, `/`, `#tag`, `@date`
    // Walk back to find an active trigger token on the current line
    const lineStart = val.lastIndexOf('\n', start - 1) + 1;
    const lineUpToCursor = val.substring(lineStart, start);
    const tagMatch = lineUpToCursor.match(/(?:^|\s)#([\w-]*)$/);
    const dateMatch = lineUpToCursor.match(/(?:^|\s)@([\w-]*)$/);

    if (lastTwo === '[[') { showAutocomplete('wiki'); }
    else if (tagMatch) { showAutocomplete('tag', tagMatch[1]); }
    else if (dateMatch) { showAutocomplete('date', dateMatch[1]); }
    else if (lastOne === '/') { showAutocomplete('slash'); }
    else { hideAutocomplete(); }
}

// FEATURE: list continuation + indent shortcuts (hybrid WYSIWYG feel)
function handleEditorKeydown(e) {
    const ta = e.target;
    if (e.key === 'Enter' && !e.shiftKey) {
        const pos = ta.selectionStart;
        const before = ta.value.substring(0, pos);
        const lineStart = before.lastIndexOf('\n') + 1;
        const line = before.substring(lineStart);
        // Match: optional indent + bullet/number/checkbox
        const m = line.match(/^(\s*)([-*+]\s\[[ x]\]\s|[-*+]\s|(\d+)\.\s)(.*)$/);
        if (m) {
            e.preventDefault();
            const indent = m[1];
            const marker = m[2];
            const content = m[4];
            // Empty list item -> break out
            if (!content.trim()) {
                const newVal = ta.value.substring(0, lineStart) + ta.value.substring(pos);
                ta.value = newVal;
                ta.selectionStart = ta.selectionEnd = lineStart;
            } else {
                let nextMarker = marker;
                // Auto-reset checkboxes; increment numbered lists
                if (/\[[ x]\]/.test(marker)) nextMarker = marker.replace(/\[[ x]\]/, '[ ]');
                const numM = marker.match(/^(\d+)\.\s$/);
                if (numM) nextMarker = (parseInt(numM[1]) + 1) + '. ';
                const insert = '\n' + indent + nextMarker;
                ta.value = ta.value.substring(0, pos) + insert + ta.value.substring(pos);
                ta.selectionStart = ta.selectionEnd = pos + insert.length;
            }
            saveNotes(); updateLivePreview();
        }
    } else if (e.key === 'Tab') {
        // Indent inside lists, instead of focus-shift
        const pos = ta.selectionStart;
        const before = ta.value.substring(0, pos);
        const lineStart = before.lastIndexOf('\n') + 1;
        const line = before.substring(lineStart);
        if (/^(\s*)([-*+]\s|\d+\.\s)/.test(line)) {
            e.preventDefault();
            if (e.shiftKey) {
                if (ta.value.substring(lineStart, lineStart + 2) === '  ') {
                    ta.value = ta.value.substring(0, lineStart) + ta.value.substring(lineStart + 2);
                    ta.selectionStart = ta.selectionEnd = pos - 2;
                }
            } else {
                ta.value = ta.value.substring(0, lineStart) + '  ' + ta.value.substring(lineStart);
                ta.selectionStart = ta.selectionEnd = pos + 2;
            }
            saveNotes(); updateLivePreview();
        }
    } else if (e.key === 'Escape') {
        hideAutocomplete();
    }
}

function showAutocomplete(type, query) {
    const ac = document.getElementById('editor-autocomplete');
    ac.classList.remove('hidden');

    // Positioning it just below toolbar for relative ease in complex textareas
    ac.style.top = '10px';
    ac.style.left = '20px';

    if (type === 'wiki') {
        const available = state.notes.filter(n => n.workspaceId === state.activeWorkspace);
        ac.innerHTML = available.map(n => `<div class="px-4 py-2 hover:bg-accent/20 cursor-pointer text-textMain" onmousedown="event.preventDefault(); insertAc('wiki', '${n.title || 'Untitled'}')"> ${n.title || 'Untitled'}</div>`).join('');
        if(available.length === 0) ac.innerHTML = '<div class="px-4 py-2 text-textMuted">No notes available</div>';
    } else if (type === 'slash') {
        ac.innerHTML = `
            <div class="px-4 py-2 hover:bg-accent/20 cursor-pointer text-textMain font-medium" onmousedown="event.preventDefault(); insertAc('slash', 'todo')"> Task Checkbox</div>
            <div class="px-4 py-2 hover:bg-accent/20 cursor-pointer text-textMain font-medium" onmousedown="event.preventDefault(); insertAc('slash', 'math')">Σ Math Block</div>
            <div class="px-4 py-2 hover:bg-accent/20 cursor-pointer text-textMain font-medium" onmousedown="event.preventDefault(); insertAc('slash', 'table')">⊞ Markdown Table</div>
            <div class="px-4 py-2 hover:bg-accent/20 cursor-pointer text-textMain font-medium" onmousedown="event.preventDefault(); insertAc('slash', 'card')"> Flashcard Outline</div>
        `;
    } else if (type === 'tag') {
        // FEATURE: # tag autocomplete from existing note tag pool
        const q = (query || '').toLowerCase();
        const allTags = new Set();
        (state.notes || []).forEach(n => (n.tags || '').split(',').map(t => t.trim()).filter(Boolean).forEach(t => allTags.add(t)));
        let items = Array.from(allTags).filter(t => t.toLowerCase().startsWith(q)).slice(0, 8);
        if (q && !items.includes(q)) items.unshift(q + '  (create new)');
        if (!items.length) { ac.innerHTML = '<div class="px-4 py-2 text-textMuted">No tags yet — keep typing to create one</div>'; return; }
        ac.innerHTML = items.map(t => {
            const clean = t.replace(/\s+\(create new\)$/, '');
            return `<div class="px-4 py-2 hover:bg-accent/20 cursor-pointer text-textMain" onmousedown="event.preventDefault(); insertAc('tag', '${clean.replace(/'/g, "\\'")}')"> ${t}</div>`;
        }).join('');
    } else if (type === 'date') {
        // FEATURE: @ date autocomplete — quick links to calendar
        const q = (query || '').toLowerCase();
        const today = new Date();
        const fmt = (d) => formatLocalDateKey(d);
        const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
        const nextWeek = new Date(today); nextWeek.setDate(today.getDate() + 7);
        const opts = [
            { label: 'today', value: fmt(today) },
            { label: 'tomorrow', value: fmt(tomorrow) },
            { label: 'next-week', value: fmt(nextWeek) },
            { label: 'now', value: `${formatLocalDateKey(today)} ${String(today.getHours()).padStart(2,'0')}:${String(today.getMinutes()).padStart(2,'0')}` },
        ].filter(o => !q || o.label.startsWith(q) || o.value.startsWith(q));
        if (!opts.length) { ac.innerHTML = '<div class="px-4 py-2 text-textMuted">Type today / tomorrow / next-week</div>'; return; }
        ac.innerHTML = opts.map(o => `<div class="px-4 py-2 hover:bg-accent/20 cursor-pointer text-textMain" onmousedown="event.preventDefault(); insertAc('date', '${o.value}')"> <span class="text-textMuted">${o.label}</span> · ${o.value}</div>`).join('');
    }
}

function hideAutocomplete() { document.getElementById('editor-autocomplete').classList.add('hidden'); }
function insertAc(type, val) {
    const ta = document.getElementById('note-body-raw');
    let start = ta.selectionStart;
    let text = ta.value;
    if (type === 'wiki') {
        ta.value = text.substring(0, start) + val + "]] " + text.substring(start);
        ta.selectionStart = ta.selectionEnd = start + val.length + 3;
    } else if (type === 'slash') {
        let insert = '';
        if(val === 'todo') insert = '- [ ] ';
        if(val === 'math') insert = '\n$$\n\n$$\n';
        if(val === 'table') insert = '\n| Col 1 | Col 2 |\n|---|---|\n| Val | Val |\n';
        if(val === 'card') insert = '\nQuestion :: Answer\n';
        ta.value = text.substring(0, start - 1) + insert + text.substring(start);
        ta.selectionStart = ta.selectionEnd = start - 1 + insert.length;
    } else if (type === 'tag' || type === 'date') {
        // Replace the partial token (#abc or @abc) on the current line with the full token
        const lineStart = text.lastIndexOf('\n', start - 1) + 1;
        const before = text.substring(0, lineStart);
        const line = text.substring(lineStart, start);
        const re = type === 'tag' ? /(?:^|\s)#([\w-]*)$/ : /(?:^|\s)@([\w-]*)$/;
        const m = line.match(re);
        if (m) {
            const cutAt = lineStart + m.index + (m[0].startsWith(' ') ? 1 : 0);
            const token = (type === 'tag' ? '#' : '@') + val + ' ';
            ta.value = text.substring(0, cutAt) + token + text.substring(start);
            ta.selectionStart = ta.selectionEnd = cutAt + token.length;
            // Also push tag into note.tags for graph/search
            if (type === 'tag') {
                const note = state.notes.find(n => n.id === state.currentNoteId);
                if (note) {
                    const tags = new Set((note.tags || '').split(',').map(t => t.trim()).filter(Boolean));
                    tags.add(val);
                    note.tags = Array.from(tags).join(', ');
                    const tagsInput = document.getElementById('note-tags');
                    if (tagsInput) tagsInput.value = note.tags;
                }
            }
        }
    }
    hideAutocomplete(); ta.focus(); saveNotes(); updateLivePreview();
}

function wrapText(prefix, suffix) {
    const ta = document.getElementById('note-body-raw');
    let start = ta.selectionStart; let end = ta.selectionEnd;
    let selectedText = ta.value.substring(start, end);
    ta.value = ta.value.substring(0, start) + prefix + selectedText + suffix + ta.value.substring(end);
    ta.selectionStart = start + prefix.length;
    ta.selectionEnd = start + prefix.length + selectedText.length;
    saveNotes(); updateLivePreview();
}

function extractTasks() {
    const textarea = document.getElementById('note-body-raw');
    let text = textarea.value;
    const regex = /\[\[Todo:\s*(.*?)\]\]/g;
    let match; let count = 0;
    while ((match = regex.exec(text)) !== null) {
        state.kanban.todo.push({ id: 'task-' + Date.now() + count, title: match[1], priority: 'Normal', due: '', workspaceId: state.activeWorkspace });
        count++;
    }
    if (count > 0) {
        textarea.value = text.replace(/\[\[Todo:\s*(.*?)\]\]/g, '[[Task Added: $1]]');
        saveNotes(); updateLivePreview(); renderKanban(); toast(`Extracted ${count} tasks to Kanban!`);
    } else { toast('No un-synced [[Todo: ...]] tags found.'); }
}

function extractFlashcards() {
    const textarea = document.getElementById('note-body-raw');
    let text = textarea.value;
    const regex = /^(.*?)\s*::\s*(.*)$/gm;
    let match; let count = 0;
    while ((match = regex.exec(text)) !== null) {
        const q = match[1].trim(); const a = match[2].trim();
        if(!q || !a) continue;
        const exists = state.flashcards.find(f => f.q === q && f.workspaceId === state.activeWorkspace);
        if(!exists) {
            state.flashcards.push({ id: 'fc-' + Date.now() + count, q: q, a: a, rep: 0, int: 1, ef: 2.5, next: Date.now(), workspaceId: state.activeWorkspace });
            count++;
        }
    }
    if (count > 0) {
        saveDataToDB(); updateFlashcardUI(); updateDashboard();
        toast(`Extracted ${count} new flashcards!`);
    } else { toast('No "Question :: Answer" lines found.'); }
}

async function importMarkdown(event) {
    const file = event.target.files[0]; if(!file) return; const reader = new FileReader();
    reader.onload = async (e) => {
        const text = e.target.result;
        const opt = await showModal({title:'Import Markdown', type:'form', fields: [{id:'mode', label:'Import Strategy', type:'select', options:['Single Note', 'Split by ## Headers']}]});
        if(!opt) { event.target.value = ''; return; }
        if(opt.mode === 'Single Note') {
            state.notes.unshift({ id: Date.now().toString(), title: file.name.replace(/\.[^/.]+$/, ""), body: text, tags: 'imported', timestamp: new Date().toLocaleDateString(), workspaceId: state.activeWorkspace });
        } else {
            const chunks = text.split('\n## ');
            chunks.forEach((chunk, i) => {
                let title = file.name.replace(/\.[^/.]+$/, ""); let body = chunk;
                if(i > 0 || chunk.startsWith('## ')) { const lines = chunk.split('\n'); title = lines[0].replace('## ', '').trim(); body = lines.slice(1).join('\n'); }
                if(body.trim() !== '') state.notes.unshift({ id: Date.now().toString() + i, title, body: body.trim(), tags: 'imported', timestamp: new Date().toLocaleDateString(), workspaceId: state.activeWorkspace });
            });
        }
        saveDataToDB(); renderNotesList(); toast('Import successful!'); event.target.value = ''; 
    };
    reader.readAsText(file);
}

function renderNotesList() {
    updateMobNotesBarCount();
    const query = (document.getElementById('note-search').value || '').toLowerCase(); const searchAll = document.getElementById('search-all-ws').checked;
    const pool = searchAll ? state.notes : state.notes.filter(n => n.workspaceId === state.activeWorkspace);
    const countEl = document.getElementById('notes-count');
    if (countEl) countEl.textContent = pool.length > 0 ? pool.length : '';

    const filtered = pool.filter(n => 
        (n.title || '').toLowerCase().includes(query) || 
        (n.tags || '').toLowerCase().includes(query) ||
        (n.body || '').toLowerCase().includes(query)
    );

    document.getElementById('note-list').innerHTML = filtered.length === 0 
        ? '<div class="text-xs text-textMuted text-center py-8 italic">No notes yet.</div>'
        : filtered.map(note => {
        const isBodyMatch = query && !(note.title || '').toLowerCase().includes(query) && !(note.tags || '').toLowerCase().includes(query) && (note.body || '').toLowerCase().includes(query);
        const snippet = (note.body || '').replace(/[#*`_>]/g, '').trim().slice(0, 55);
        const safeTitle = escapeHTML(note.title || 'Untitled');
        const safeSnippet = escapeHTML(snippet);
        const wc = (note.body || '').trim().split(/\s+/).filter(Boolean).length;
        const tags = (note.tags || '').split(',').map(t=>t.trim()).filter(Boolean).slice(0,2);
        const safeTags = tags.map(escapeHTML);
        const wsName = state.workspaces.find(w=>w.id===note.workspaceId)?.name || '';
        const safeWsName = escapeHTML(wsName);
        const isActive = state.currentNoteId === note.id;
        return `
        <div data-id="${note.id}" class="note-item group px-2.5 py-2 rounded-lg cursor-pointer flex flex-col gap-0.5 relative ${isActive ? 'active-note' : ''}">
            <div class="flex justify-between items-center w-full gap-1" onclick="loadNoteIntoEditor('${note.id}')">
                <span class="note-title-text truncate text-[13px] font-medium ${isActive ? 'text-accent' : 'text-textMain'} flex-1">${safeTitle}</span>
                ${searchAll && note.workspaceId !== state.activeWorkspace ? `<span class="text-[9px] opacity-50 px-1 border border-borderDark rounded bg-bgDark shrink-0">${safeWsName}</span>` : ''}
                <button onclick="event.stopPropagation(); deleteNoteById('${note.id}')" class="shrink-0 w-5 h-5 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 hover:bg-red-400/15 text-red-400/60 hover:text-red-400 transition text-xs" title="Delete note"></button>
            </div>
            ${snippet ? `<div class="text-[11px] text-textMuted truncate" onclick="loadNoteIntoEditor('${note.id}')">${isBodyMatch ? '<span class="text-accent">↳ </span>' : ''}${safeSnippet}</div>` : ''}
            <div class="flex items-center gap-1.5 mt-0.5" onclick="loadNoteIntoEditor('${note.id}')">
                ${safeTags.map(t => `<span class="text-[9px] px-1.5 py-0.5 bg-accent/10 text-accent rounded-md">${t}</span>`).join('')}
                ${wc > 0 ? `<span class="text-[9px] text-textMuted/50 ml-auto">${wc}w</span>` : ''}
            </div>
        </div>
    `}).join('');
}
function filterNotes() { renderNotesList(); updateMobNotesBarCount(); }

function noteUiText(key, fallback) { return window.GraphiteI18n?.t ? window.GraphiteI18n.t(key, fallback) : fallback; }

function loadNoteIntoEditor(id) {
    const note = state.notes.find(n => n.id === id); if(!note) return;
    state.currentNoteId = id;
    document.getElementById('editor-empty').classList.add('hidden'); document.getElementById('editor-active').classList.remove('hidden');
    document.getElementById('note-title').value = note.title; document.getElementById('note-tags').value = note.tags;
    document.getElementById('note-timestamp').innerText = `Created: ${note.timestamp}`; 
    document.getElementById('note-body-raw').value = note.body;
    const saveStatus = document.getElementById('note-save-status');
    if (saveStatus) { saveStatus.textContent = noteUiText('Saved', 'Saved'); saveStatus.classList.remove('is-saving'); }

    undoStack = [note.body || '']; redoStack = [];
    updateLivePreview(); renderNotesList(); renderBacklinks(id);
    // Open notes in Review/Preview by default so selecting a note immediately
    // shows its rendered content instead of dropping the user into the editor.
    switchEditorTab('preview'); updateWordCount(); highlightActiveNote();
    if (isFocusMode && state.settings.focusAwareEnabled) refreshFocusSuggestions();
}

function saveNotes() {
    if(!state.currentNoteId) return;
    const saveStatus = document.getElementById('note-save-status');
    if (saveStatus) { saveStatus.textContent = noteUiText('Saving', 'Saving'); saveStatus.classList.add('is-saving'); }
    const note = state.notes.find(n => n.id === state.currentNoteId);
    if(note) { 
        note.title = document.getElementById('note-title').value; 
        note.tags = document.getElementById('note-tags').value; 
        note.body = document.getElementById('note-body-raw').value; 

        clearTimeout(snapshotTimeout);
        snapshotTimeout = setTimeout(() => { takeSnapshot(note.body); }, 700);

        // Debounced auto-save — coalesces rapid keystrokes (800ms)
        clearTimeout(window.__noteSaveDebounce);
        window.__noteSaveDebounce = setTimeout(() => {
            saveDataToDB();
            if (saveStatus) { saveStatus.textContent = noteUiText('Saved', 'Saved'); saveStatus.classList.remove('is-saving'); }
            // Only patch the active item in the list rather than re-rendering all notes
            const el = document.querySelector(`.note-item[data-id="${note.id}"]`);
            if (el) {
                const titleEl = el.querySelector('.note-title-text');
                if (titleEl) titleEl.textContent = note.title || 'Untitled';
            } else {
                renderNotesList(); // fallback if item not found
            }
        }, 800);
    }
}

function undoNote() {
    if (undoStack.length > 1) {
        const current = undoStack.pop(); redoStack.push(current);
        const previous = undoStack[undoStack.length - 1];
        document.getElementById('note-body-raw').value = previous;
        const note = state.notes.find(n => n.id === state.currentNoteId);
        if(note) { note.body = previous; saveDataToDB(); }
        updateLivePreview();
    } else { toast("Nothing left to undo."); }
}

function redoNote() {
    if (redoStack.length > 0) {
        const next = redoStack.pop(); undoStack.push(next);
        document.getElementById('note-body-raw').value = next;
        const note = state.notes.find(n => n.id === state.currentNoteId);
        if(note) { note.body = next; saveDataToDB(); }
        updateLivePreview();
    } else { toast("Nothing to redo."); }
}

function openWikiLink(title) {
    const wsNotes = state.notes.filter(n => n.workspaceId === state.activeWorkspace);
    let targetNote = wsNotes.find(n => (n.title||'').toLowerCase() === title.toLowerCase());
    if(!targetNote) targetNote = state.notes.find(n => (n.title||'').toLowerCase() === title.toLowerCase());
    if(targetNote) { loadNoteIntoEditor(targetNote.id); } else { toast(`Note "${title}" not found.`); }
}

function renderNoteMarkdown(raw, preview) {
    if (!preview) return;
    const wikiTitles = [];
    const source = String(raw || '').replace(/\[\[([^\]\n]+)\]\]/g, (match, title) => {
        const cleanTitle = String(title).trim();
        const index = wikiTitles.push(cleanTitle) - 1;
        return `<span data-wiki-title="${escapeHTML(cleanTitle)}" data-wiki-index="${index}">${escapeHTML(cleanTitle)}</span>`;
    });

    renderMarkdownWithMath(source, preview);

    preview.querySelectorAll('[data-wiki-title]').forEach(el => {
        const title = el.getAttribute('data-wiki-title') || '';
        const exists = state.notes.some(n => n.workspaceId === state.activeWorkspace && (n.title || '').toLowerCase() === title.toLowerCase());
        el.className = `wiki-link${exists ? '' : ' opacity-50'}`;
        el.title = exists ? 'Open note' : 'Note not found';
        el.setAttribute('role', 'link');
        el.tabIndex = 0;
        const open = () => openWikiLink(title);
        el.addEventListener('click', open);
        el.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
        });
    });
}

function updateLivePreview() {
    const raw = document.getElementById('note-body-raw')?.value || '';
    const preview = document.getElementById('markdown-preview');
    if (!preview) return;

    renderNoteMarkdown(raw, preview);
    const titleEl = document.getElementById('preview-note-title');
    const activeNote = state.notes.find(n => n.id === state.currentNoteId);
    if (titleEl) titleEl.textContent = activeNote?.title || noteUiText('Untitled Note', 'Untitled Note');

    // Render interactive checkboxes after the unified Markdown + KaTeX pass.
    preview.querySelectorAll('li input[type="checkbox"]').forEach(cb => {
        cb.classList.add('markdown-checkbox');
        cb.removeAttribute('disabled');
        cb.addEventListener('change', () => {
            const ta = document.getElementById('note-body-raw');
            if (!ta) return;
            const marker = cb.checked ? '- [x]' : '- [ ]';
            const unchecked = /- \[ \]/;
            const checked = /- \[x\]/i;
            ta.value = cb.checked ? ta.value.replace(unchecked, marker) : ta.value.replace(checked, marker);
            saveNotes();
            updateLivePreview();
        });
    });
}

/* --- EDITOR TAB SWITCHING --- */
// Mobile-only: the eye icon in the toolbar toggles Write/Preview,
// replacing the desktop text tab bar. Delegates to the same
// switchEditorTab() the desktop tabs use, so all preview logic
// (markdown render, backlinks, focus suggestions) stays identical.
function mobileTogglePreview() {
    const writeTab = document.getElementById('editor-tab-write');
    const goingToPreview = writeTab && !writeTab.classList.contains('hidden');
    switchEditorTab(goingToPreview ? 'preview' : 'write');
}

function switchEditorTab(tab) {
    const writeTab = document.getElementById('editor-tab-write');
    const previewTab = document.getElementById('editor-tab-preview');
    const splitTab = document.getElementById('editor-tab-split');
    const writBtn = document.getElementById('tab-btn-write');
    const prevBtn = document.getElementById('tab-btn-preview');
    const splitBtn = document.getElementById('tab-btn-split');
    if (!writeTab || !previewTab) return;

    // Reset all tabs
    writeTab.classList.add('hidden'); writeTab.style.display = '';
    previewTab.classList.add('hidden'); previewTab.style.display = '';
    if (splitTab) { splitTab.classList.remove('split-active'); splitTab.style.display = 'none'; }

    // Reset all tab buttons
    [writBtn, prevBtn, splitBtn].forEach(b => {
        if (b) { b.classList.remove('text-accent', 'border-accent'); b.classList.add('text-textMuted', 'border-transparent'); }
    });

    // Toggle mobile preview-mode hiding of undo/redo/overflow
    const editorToolbar = document.querySelector('#editor-active .glass-sidebar.shrink-0');
    if (editorToolbar) {
        editorToolbar.classList.toggle('note-preview-mode', tab === 'preview');
    }

    if (tab === 'write') {
        writeTab.classList.remove('hidden'); writeTab.style.display = 'flex';
        writBtn.classList.add('text-accent', 'border-accent');
        writBtn.classList.remove('text-textMuted', 'border-transparent');
        setTimeout(() => document.getElementById('note-body-raw')?.focus(), 50);
    } else if (tab === 'split' && window.innerWidth >= 768) {
        // Split mode: sync content to split panes and show
        const body = document.getElementById('note-body-raw').value;
        const title = document.getElementById('note-title').value;
        const splitBody = document.getElementById('split-body-raw');
        const splitTitle = document.getElementById('split-note-title-mirror');
        if (splitBody) { splitBody.value = body; splitBody.readOnly = false; }
        if (splitTitle) { splitTitle.value = title; splitTitle.readOnly = false; }
        updateSplitPreview();

        splitTab.classList.add('split-active'); splitTab.style.display = '';
        if (splitBtn) { splitBtn.classList.add('text-accent', 'border-accent'); splitBtn.classList.remove('text-textMuted', 'border-transparent'); }
        setTimeout(() => document.getElementById('split-body-raw')?.focus(), 50);
    } else {
        // Preview mode
        updateLivePreview();
        previewTab.classList.remove('hidden'); previewTab.style.display = 'flex';
        prevBtn.classList.add('text-accent', 'border-accent');
        prevBtn.classList.remove('text-textMuted', 'border-transparent');
    }

    // Keep the mobile eye icon's active/purple state in sync no matter
    // how this function was invoked (eye tap, keyboard shortcut, etc.)
    const eyeBtn = document.getElementById('mob-eye-btn');
    if (eyeBtn) eyeBtn.classList.toggle('mob-eye-active', tab === 'preview');
}

function updateSplitPreview() {
    const raw = document.getElementById('split-body-raw')?.value || document.getElementById('note-body-raw')?.value || '';
    const preview = document.getElementById('split-markdown-preview');
    if (!preview) return;
    renderNoteMarkdown(raw, preview);
}

function syncSplitToMain(val) {
    // Sync split textarea → main textarea → save
    const mainTa = document.getElementById('note-body-raw');
    if (mainTa) mainTa.value = val;
    saveNotes();
    updateSplitPreview();
}

function renderBacklinks(noteId) {
    const note = state.notes.find(n => n.id === noteId); const container = document.getElementById('backlinks-container');
    if(!note || !note.title) { container.innerHTML = '<i>Requires title.</i>'; return; }
    const titleLower = note.title.toLowerCase();
    const backlinks = state.notes.filter(n => n.id !== noteId && n.body.toLowerCase().includes(`[[${titleLower}]]`));
    container.innerHTML = backlinks.length === 0 ? '<i>No links found.</i>' : backlinks.map(b => `<div class="cursor-pointer hover:text-accent truncate flex justify-between py-1 border-b border-borderDark/30" onclick="loadNoteIntoEditor('${b.id}')"><span>↗ ${b.title || 'Untitled'}</span> ${b.workspaceId !== note.workspaceId ? `<span class="text-[9px] opacity-50 px-1 border border-borderDark rounded bg-bgDark">${state.workspaces.find(w=>w.id===b.workspaceId)?.name}</span>` : ''}</div>`).join('');
}

function insertFormula() {
    const textarea = document.getElementById('note-body-raw'); const pos = textarea.selectionStart;
    textarea.value = textarea.value.substring(0, pos) + "\n$$\n x = {-b \\pm \\sqrt{b^2-4ac} \\over 2a} \n$$\n" + textarea.value.substring(pos);
    saveNotes(); updateLivePreview(); textarea.focus();
}

async function deleteCurrentNote() {
    if(!await showModal({ title: 'Delete Note', content: 'Are you sure?', type: 'confirm' })) return;
    state.notes = state.notes.filter(n => n.id !== state.currentNoteId); state.currentNoteId = null;
    document.getElementById('editor-empty').classList.remove('hidden'); document.getElementById('editor-active').classList.add('hidden');
    saveDataToDB(); renderNotesList();
}

