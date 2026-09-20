/* --- KEYBOARD SHORTCUTS & COMMAND PALETTE --- */
const cmdPalette = document.getElementById('cmd-palette'); const cmdInput = document.getElementById('cmd-input'); const cmdResults = document.getElementById('cmd-results');
let cmdActiveIndex = 0; let cmdOptions = [];

function toggleCmdPalette() {
    if(cmdPalette.classList.contains('hidden')) { cmdPalette.classList.remove('hidden'); cmdInput.value = ''; updateCmdResults(); setTimeout(() => cmdInput.focus(), 50); } 
    else { cmdPalette.classList.add('hidden'); }
}

function updateCmdResults() {
    const q = cmdInput.value.toLowerCase();
    const actions = [
        { title: 'Go to Dashboard', icon: '', action: () => switchApp('dashboard') },
        { title: 'Go to Notes', icon: '', action: () => switchApp('notes') },
        { title: 'Go to Tasks', icon: '', action: () => switchApp('kanban') },
        { title: 'Go to Focus Timer', icon: '⏱', action: () => switchApp('pomodoro') },
        { title: 'Go to Knowledge Graph', icon: '', action: () => switchApp('graph') },
        { title: 'Go to Calendar', icon: '', action: () => switchApp('calendar') },
        { title: 'Go to Settings', icon: '', action: () => switchApp('settings') },
        { title: 'Create New Note', icon: '', action: () => { switchApp('notes'); createNewNote(); } }
    ];
    state.notes.filter(n => n.workspaceId === state.activeWorkspace).forEach(n => actions.push({ title: `Open Note: ${n.title || 'Untitled'}`, icon: '', action: () => { switchApp('notes'); loadNoteIntoEditor(n.id); } }));
    cmdOptions = actions.filter(a => a.title.toLowerCase().includes(q)).slice(0, 8); cmdActiveIndex = 0; renderCmdList();
}

function renderCmdList() {
    cmdResults.innerHTML = cmdOptions.length === 0 ? '<div class="p-4 text-sm text-textMuted text-center">No results found.</div>' : cmdOptions.map((opt, i) => `
        <div class="cmd-item p-4 md:p-3 text-sm text-textMuted rounded-lg cursor-pointer flex items-center gap-3 ${i === cmdActiveIndex ? 'active' : ''}" onclick="executeCmd(${i})">
            <span class="opacity-50">${opt.icon}</span> ${opt.title}
        </div>`).join('');
}

function executeCmd(index) { if(cmdOptions[index]) { cmdOptions[index].action(); cmdPalette.classList.add('hidden'); } }

// FEATURE: Keyboard Suite & Indentation
window.addEventListener('keydown', (e) => {
    // Check canvas spacebar logic
    if (e.code === 'Space' && !['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName) && !e.target.isContentEditable) { spaceHeld = true; if(canvas) canvas.style.cursor = 'grab'; e.preventDefault(); return; }

    // Hover-draw hotkey: activate hands-free drawing when on whiteboard
    if (currentApp === 'canvas' && canvas && !['INPUT','TEXTAREA'].includes(e.target.tagName)) {
        const hdk = (state.settings.hoverDrawKey || 'f').toLowerCase();
        if (e.key.toLowerCase() === hdk && !e.ctrlKey && !e.metaKey && !e.altKey && !hoverDrawActive) {
            hoverDrawActive = true;
            e.preventDefault();
            return;
        }
    }

    // Note Editor Shortcuts
    if (currentApp === 'notes' && e.target.id === 'note-body-raw') {
        if (e.key === 'Tab') {
            e.preventDefault();
            let ta = e.target; let start = ta.selectionStart; let end = ta.selectionEnd;
            if (!e.shiftKey) { 
                ta.value = ta.value.substring(0, start) + "  " + ta.value.substring(end);
                ta.selectionStart = ta.selectionEnd = start + 2;
            } else { 
                let textBefore = ta.value.substring(0, start);
                let lineStart = textBefore.lastIndexOf('\n') + 1;
                if (ta.value.substring(lineStart, lineStart + 2) === "  ") {
                    ta.value = ta.value.substring(0, lineStart) + ta.value.substring(lineStart + 2);
                    ta.selectionStart = ta.selectionEnd = Math.max(0, start - 2);
                }
            }
            saveNotes(); updateLivePreview(); return;
        }
        if ((e.ctrlKey || e.metaKey) && e.key === 'b') { e.preventDefault(); wrapText('**', '**'); return; }
        if ((e.ctrlKey || e.metaKey) && e.key === 'i') { e.preventDefault(); wrapText('*', '*'); return; }
    }

    // Global System Shortcuts
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); toggleCmdPalette(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveDataToDB(); toast('Saved manually'); return; }
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') { if(currentApp === 'notes' && state.currentNoteId) { e.preventDefault(); undoNote(); return; } }
    if ((e.ctrlKey || e.metaKey) && e.key === 'y') { if(currentApp === 'notes' && state.currentNoteId) { e.preventDefault(); redoNote(); return; } }

    if (e.altKey && e.key === 'n') { e.preventDefault(); switchApp('notes'); createNewNote(); return; }
    if (e.altKey && e.key === 't') { e.preventDefault(); if(isFocusMode) attemptEarlyExit(); else startTimer(); return; }

    if (e.key === 'Escape') {
        if(!cmdPalette.classList.contains('hidden')) toggleCmdPalette();
        document.getElementById('custom-modal').classList.add('hidden');
        document.getElementById('graph-popover').classList.add('hidden');
        hideAutocomplete();
        if(window.innerWidth < 768) {
            document.getElementById('main-sidebar').classList.add('-translate-x-full');
            document.getElementById('mobile-overlay').classList.add('hidden');
        }
    }

    // Cmd Palette Nav
    if (!cmdPalette.classList.contains('hidden')) {
        if (e.key === 'ArrowDown') { e.preventDefault(); cmdActiveIndex = (cmdActiveIndex + 1) % cmdOptions.length; renderCmdList(); }
        if (e.key === 'ArrowUp') { e.preventDefault(); cmdActiveIndex = (cmdActiveIndex - 1 + cmdOptions.length) % cmdOptions.length; renderCmdList(); }
        if (e.key === 'Enter') { e.preventDefault(); executeCmd(cmdActiveIndex); }
    }
});
window.addEventListener('keyup', (e) => { 
    if (e.code === 'Space') { spaceHeld = false; if(canvas) canvas.style.cursor = currentTool === 'pan' ? 'grab' : 'crosshair'; }
    // Stop hover-draw
    if (hoverDrawActive) {
        const hdk = (state.settings.hoverDrawKey || 'f').toLowerCase();
        if (e.key.toLowerCase() === hdk) {
            hoverDrawActive = false;
            if (isDrawing && currentStroke) endAction();
        }
    }
});
cmdInput.addEventListener('input', updateCmdResults);

/* --- MODALS & UTILS --- */
