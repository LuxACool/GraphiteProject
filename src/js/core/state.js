/* =========================================
   INDEXED DB STORAGE & STATE ENGINE
   ========================================= */
let state = {
    workspaces: [{ id: 'ws-default', name: 'Main Workspace', color: '#8b5cf6', lastApp: 'dashboard', focusMinutes: 0 }],
    activeWorkspace: 'ws-default',
    goal: "Type Goal Here",
    pomodoroCount: 0,
    notes: [],
    currentNoteId: null,
    kanban: { todo: [], progress: [], done: [] },
    flashcards: [], 
    canvasStrokes: [],
    calendarBlocks: {},
    activityHistory: {},
    kssHistory: [],          // NEW: array of {date, score, total, linked} snapshots
    settings: { 
        theme: 'dark', accent: '#3B82F6',
        wallpaper: '', glassOpacity: 0.82, glassBlur: 18, ambientSound: 'none',
        blocklist: 'dont use this feature. Does not work lol',
        focusAwareEnabled: true, preset: 'graphiteblue',
        openaiKey: '', openaiBase: '', aiProvider: 'free',
        hoverDrawKey: 'f'
    },
    journal: {},        // { 'YYYY-MM-DD': {mood, energy, entry, wins:[]} }
    habits: [],         // [{id, name, log:{date:true}}]
    reading: [],        // [{id, title, url, note, done, added}]
    tutorChat: [],      // [{role,content}]
    sessionLog: [],     // [{id, date, subject, duration, workspaceId}]
    examCountdowns: [], // [{id, title, date, subject, workspaceId}]
    xp: 0, badges: []
};

window.Graphite = window.Graphite || {};
window.Graphite.getState = () => state;

function formatLocalDateKey(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

const todayKey = () => formatLocalDateKey();

async function initDB() {
    await Graphite.persistence.open();
    return loadDataFromDB();
}

let _stateDirty = false;
async function saveDataToDB() {
    if (!Graphite?.persistence) return false;
    _stateDirty = false;
    try {
        if (Graphite.dualWrite?.isAuthoritative?.() && Graphite.dualWrite.available()) {
            // SQLite is authoritative. IndexedDB is updated only after the
            // SQLite transaction succeeds, keeping it as a compatibility
            // snapshot for rollback/recovery.
            await Graphite.dualWrite.syncNow(state);
            await Graphite.persistence.save(state);
        } else {
            await Graphite.persistence.save(state);
            Graphite.dualWrite?.queue(state);
        }
        Graphite.events?.emit('state:saved', { state, sourceOfTruth: Graphite.dualWrite?.isAuthoritative?.() ? 'sqlite' : 'indexeddb' });
        if (currentApp === 'dashboard') updateDashboard();
        return true;
    } catch (err) {
        _stateDirty = true;
        console.error('Graphite: failed to persist state:', err);
        // If SQLite becomes unavailable, keep the app usable through IndexedDB
        // and explicitly mark the storage layer degraded.
        try { await Graphite.persistence.save(state); } catch (_) {}
        Graphite.events?.emit('storage:degraded', { error: err, fallback: 'indexeddb' });
        if (typeof toast === 'function') toast('SQLite save failed; your data was saved to the local fallback.', 'error');
        return false;
    }
}

function markDirty() { _stateDirty = true; }

function loadDataFromDB() {
    return Graphite.persistence.load().then(async (saved) => {
        // Normalize the first-run path too. Previously the default settings
        // were only rebuilt inside the `saved` branch, which allowed a fresh
        // install to inherit the browser/WebView light base variables.
        if (!saved) {
            state.settings = {
                theme: 'dark', accent: '#3B82F6', wallpaper: '',
                glassOpacity: 0.82, glassBlur: 18, ambientSound: 'none',
                blocklist: 'dont use this feature. Does not work lol',
                focusAwareEnabled: true, preset: 'graphiteblue',
                openaiKey: '', openaiBase: '', aiProvider: 'free', hoverDrawKey: 'f'
            };
        } else {
            state = { ...state, ...saved };
                const savedSettings = saved.settings && typeof saved.settings === 'object' ? saved.settings : {};
                state.settings = {
                    theme: 'dark',
                    accent: '#3B82F6',
                    wallpaper: '',
                    glassOpacity: 0.82,
                    glassBlur: 18,
                    ambientSound: 'none',
                    blocklist: 'dont use this feature. Does not work lol',
                    focusAwareEnabled: true,
                    preset: 'graphiteblue',
                    openaiKey: '',
                    openaiBase: '',
                    aiProvider: 'free',
                    hoverDrawKey: 'f',
                    ...savedSettings
                };
                // A missing preset means the user has never chosen one.
                // Keep Graphite Blue as the intentional first-run default.
                if (!Object.prototype.hasOwnProperty.call(savedSettings, 'preset') || !savedSettings.preset) {
                    state.settings.preset = 'graphiteblue';
                }

                if(!state.workspaces) state.workspaces = [{ id: 'ws-default', name: 'Main Workspace', color: '#8b5cf6', lastApp: 'dashboard', focusMinutes: 0 }];
                if(!state.activeWorkspace) state.activeWorkspace = state.workspaces[0].id;

                // Normalize older or partially-corrupt backups before any
                // feature code touches their arrays. This prevents one bad
                // field from aborting the entire app boot.
                state.notes = Array.isArray(state.notes) ? state.notes : [];
                state.flashcards = Array.isArray(state.flashcards) ? state.flashcards : [];
                state.canvasStrokes = Array.isArray(state.canvasStrokes) ? state.canvasStrokes : [];
                state.kanban = state.kanban && typeof state.kanban === 'object' ? state.kanban : {};
                ['todo', 'progress', 'done'].forEach(col => {
                    if (!Array.isArray(state.kanban[col])) state.kanban[col] = [];
                });
                state.workspaces.forEach(w => w.focusMinutes = Number(w.focusMinutes) || 0);
                state.notes.forEach(n => { if(!n.workspaceId) n.workspaceId = state.workspaces[0].id; });
                ['todo', 'progress', 'done'].forEach(col => state.kanban[col].forEach(t => { if(!t.workspaceId) t.workspaceId = state.workspaces[0].id; }));
                state.flashcards.forEach(c => { if(!c.workspaceId) c.workspaceId = state.workspaces[0].id; });
                state.canvasStrokes.forEach(s => { if(!s.workspaceId) s.workspaceId = state.workspaces[0].id; });
                if (!state.calendarBlocks || typeof state.calendarBlocks !== 'object' || Array.isArray(state.calendarBlocks)) {
                    state.calendarBlocks = {};
                }
                if (!state.calendarBlocks[state.workspaces[0].id]) {
                    // Migrate the pre-workspace calendar shape once.
                    const old = state.calendarBlocks;
                    const looksLikeWorkspaceMap = Object.keys(old).some(k => state.workspaces.some(w => w.id === k));
                    if (!looksLikeWorkspaceMap && Object.keys(old).length) {
                        state.calendarBlocks = {};
                        state.calendarBlocks[state.workspaces[0].id] = old;
                    }
                }
                if(!state.activityHistory || typeof state.activityHistory !== 'object') state.activityHistory = {};

                // Settings Defaults
                if(!state.settings) state.settings = { theme: 'dark', accent: '#8b5cf6', preset: 'graphiteblue' };
                if (!Object.prototype.hasOwnProperty.call(state.settings, 'preset') || !state.settings.preset) state.settings.preset = 'graphiteblue';
                if(state.settings.glassOpacity === undefined) state.settings.glassOpacity = 0.82;
                if(state.settings.glassBlur === undefined) state.settings.glassBlur = 18;
                if(!state.settings.ambientSound) state.settings.ambientSound = 'none';
                if(!state.settings.blocklist) state.settings.blocklist = 'reddit.com, twitter.com, instagram.com';
                if(!state.kssHistory) state.kssHistory = [];
                if(!state.sessionLog) state.sessionLog = [];
                if(!state.examCountdowns) state.examCountdowns = [];
                if(state.settings.focusAwareEnabled === undefined) state.settings.focusAwareEnabled = true;
                if(state.settings.wallpaperIsLocal === undefined) state.settings.wallpaperIsLocal = false;
                if(!state.settings.aiProvider) state.settings.aiProvider = state.settings.openaiKey ? 'openai' : 'free';
                if(!state.settings.hoverDrawKey) state.settings.hoverDrawKey = 'f';
            }

            // Phase E: once migration has completed, SQLite becomes the read
            // authority. Legacy IndexedDB-only state remains in memory only for
            // fields that have not yet moved to SQLite.
            try {
                if (Graphite.native?.available && Graphite.database?.initialize) {
                    await Graphite.database.initialize();
                    let migrationStatus = await Graphite.migration?.status?.();
                    if (migrationStatus?.state !== 'completed') {
                        try {
                            await Graphite.migration?.run?.();
                            migrationStatus = await Graphite.migration?.status?.();
                        } catch (migrationError) {
                            console.warn('Graphite SQLite migration did not complete; retaining IndexedDB authority:', migrationError);
                        }
                    }
                    if (migrationStatus?.state === 'completed') {
                        // Phase F persistence extension: seed the remaining domains exactly once
                        // from the legacy snapshot before making SQLite authoritative for them.
                        const remainingReady = await Graphite.native.invoke('repository_remaining_initialized');
                        if (!remainingReady) {
                            await Graphite.dualWrite.syncNow(state);
                        }
                        const authoritative = await Graphite.dualWrite.readAuthoritative();
                        state = Graphite.dualWrite.fromPayload(authoritative, state);
                        Graphite.dualWrite.setAuthoritative(true);
                        Graphite.events?.emit('storage:authority', { sourceOfTruth: 'sqlite', remainingDomains: 'sqlite' });
                    }
                }
            } catch (sqliteError) {
                Graphite.dualWrite?.setAuthoritative?.(false);
                console.warn('Graphite SQLite authority unavailable; using IndexedDB fallback:', sqliteError);
                Graphite.events?.emit('storage:degraded', { error: sqliteError, fallback: 'indexeddb' });
            }

            applySettings();

            document.getElementById('ws-name-display').innerText = state.workspaces.find(w => w.id === state.activeWorkspace)?.name || 'Workspace';
            document.getElementById('breadcrumb-ws').innerText = state.workspaces.find(w => w.id === state.activeWorkspace)?.name || 'Workspace';
            document.getElementById('ws-color-indicator').style.backgroundColor = state.workspaces.find(w => w.id === state.activeWorkspace)?.color || '#8b5cf6';

            bootOS();
        return state;
    });
}

async function deleteNoteById(id) {
    if (!await showModal({
        title: 'Delete note?',
        content: 'This cannot be undone.',
        type: 'confirm'
    })) return;
    state.notes = state.notes.filter(n => n.id !== id);
    if (state.currentNoteId === id) {
        state.currentNoteId = null;
        document.getElementById('editor-empty').classList.remove('hidden');
        document.getElementById('editor-active').classList.add('hidden');
    }
    saveDataToDB(); renderNotesList();
    toast('Note deleted.');
}

async function hardReset() {
    if (!await showModal({
        title: 'Wipe all data?',
        content: 'This permanently deletes every workspace, note, task, and setting. This cannot be undone.',
        type: 'confirm'
    })) return;

    try {
        if (Graphite.database?.isAvailable?.()) await Graphite.database.reset();
        await Graphite.persistence.reset();
        localStorage.clear();
        sessionStorage.clear();
        location.reload();
    } catch (e) {
        console.error('Failed to wipe Graphite data:', e);
        toast(e?.message || 'Could not wipe all data. Please close other Graphite windows and try again.', 'error');
    }
}

/* --- FEATURE: DATA BACKUP/RESTORE --- */
function createPortableBackupPayload() {
    return {
        format: 'graphite-backup',
        formatVersion: 2,
        app: 'Graphite',
        createdAt: new Date().toISOString(),
        sourceOfTruth: Graphite.dualWrite?.isAuthoritative?.() ? 'sqlite' : 'indexeddb',
        database: { name: Graphite.persistence?.DB_NAME || 'Graphite_DB', version: Graphite.persistence?.DB_VERSION || 1 },
        state: JSON.parse(JSON.stringify(state))
    };
}

async function exportVault() {
    try {
        // Flush the current state before exporting so the JSON and native store
        // represent the same moment in time. Native builds also keep a private
        // full DB/assets snapshot for recovery; the downloaded JSON is the
        // portable, user-importable backup.
        await Graphite.dualWrite?.flush?.();
        if (Graphite.native?.available) await Graphite.services?.backup?.snapshot?.();
        const payload = createPortableBackupPayload();
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const downloadAnchorNode = document.createElement('a');
        downloadAnchorNode.href = url;
        downloadAnchorNode.download = `graphite-backup-${todayKey()}.json`;
        document.body.appendChild(downloadAnchorNode);
        downloadAnchorNode.click();
        downloadAnchorNode.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        toast('Graphite backup exported successfully.', 'success');
    } catch (error) {
        console.error('Graphite backup export failed:', error);
        toast(error?.message || 'Could not export the Graphite backup.', 'error');
    }
}

function normalizeImportedBackup(imported) {
    const payload = imported?.format === 'graphite-backup' ? imported.state : imported;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Invalid Graphite backup.');
    if (!Array.isArray(payload.workspaces) || payload.workspaces.length === 0) throw new Error('Backup is missing workspaces.');
    if (!Array.isArray(payload.notes)) throw new Error('Backup is missing notes.');
    if (payload.kanban && typeof payload.kanban !== 'object') throw new Error('Backup contains invalid Kanban data.');
    return payload;
}

async function importVault(event) {
    const file = event?.target?.files?.[0];
    if (!file) return;
    try {
        const imported = JSON.parse(await file.text());
        const importedState = normalizeImportedBackup(imported);
        // Replace the current state rather than shallow-merging it. This prevents
        // stale notes, quiz cards, settings, habits, sessions, etc. from surviving
        // a restore when the backup intentionally contains an empty collection.
        state = { ...state, ...importedState };
        if (!state.settings || typeof state.settings !== 'object') state.settings = {};
        state.settings = {
            theme: 'dark', accent: '#3B82F6', wallpaper: '', glassOpacity: 0.82, glassBlur: 18,
            ambientSound: 'none', focusAwareEnabled: true, preset: 'graphiteblue', ...state.settings
        };
        await saveDataToDB();
        toast('Graphite backup imported successfully. Reloading…', 'success');
        setTimeout(() => location.reload(), 900);
    } catch (error) {
        console.error('Graphite backup import failed:', error);
        toast(error?.message || 'Invalid Graphite backup file.', 'error');
    } finally {
        if (event?.target) event.target.value = '';
    }
}

// FEATURE: File System Access API
async function syncToFolder() {
    if (!window.showDirectoryPicker) {
        toast("Your browser doesn't support local folder sync."); return;
    }
    try {
        const dirHandle = await window.showDirectoryPicker({mode: 'readwrite'});
        let count = 0;
        for (const note of state.notes) {
            if(!note.title) continue;
            const safeTitle = note.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
            const fileHandle = await dirHandle.getFileHandle(`${safeTitle}.md`, {create: true});
            const writable = await fileHandle.createWritable();
            await writable.write(note.body || '');
            await writable.close();
            count++;
        }
        toast(`Successfully synced ${count} notes to folder!`);
    } catch (err) {
        toast("Sync aborted or failed.");
    }
}

function trackActivity(type) {
    const date = todayKey();
    if(!state.activityHistory[date]) state.activityHistory[date] = { pomodoros: 0, tasks: 0 };
    state.activityHistory[date][type]++; saveDataToDB();
}

/* ═══════════════════════════════════════════════════════
   MOBILE SIDEBAR MANAGEMENT
   ========================================= */
function toggleSidebar() {
    const sidebar = document.getElementById('main-sidebar');
    const overlay = document.getElementById('mobile-overlay');
    const isOpen = !sidebar.classList.contains('-translate-x-full');
    if (isOpen) {
        sidebar.classList.add('-translate-x-full');
        overlay.classList.add('hidden');
    } else {
        sidebar.classList.remove('-translate-x-full');
        overlay.classList.remove('hidden');
    }
}

/* Mobile notes list toggle — opens/closes the overlay panel */
function toggleMobileNotesList() {
    const panel = document.getElementById('notes-list-panel');
    if (!panel) return;
    const isOpen = panel.classList.contains('mob-list-open');
    panel.classList.toggle('mob-list-open', !isOpen);
    const chevron = document.getElementById('mob-notes-bar-chevron');
    if (chevron) chevron.style.transform = isOpen ? '' : 'rotate(180deg)';
}
function closeMobileNotesList() {
    const panel = document.getElementById('notes-list-panel');
    if (panel) panel.classList.remove('mob-list-open');
    const chevron = document.getElementById('mob-notes-bar-chevron');
    if (chevron) chevron.style.transform = '';
}
/* Keep the count badge in the browse bar in sync */
function updateMobNotesBarCount() {
    const el = document.getElementById('mob-notes-bar-count');
    if (!el) return;
    const count = (state.notes || []).filter(n => n.workspaceId === state.activeWorkspace).length;
    el.textContent = count;
}
/* Auto-close the notes overlay when a note is tapped on mobile */
document.addEventListener('click', function(e) {
    if (window.innerWidth >= 768) return;
    const panel = document.getElementById('notes-list-panel');
    if (!panel || !panel.classList.contains('mob-list-open')) return;
    if (e.target.closest('.note-item')) {
        setTimeout(closeMobileNotesList, 120);
    }
});

// Swipe-to-close for mobile sidebar
(function() {
    let touchStartX = 0;
    let touchStartY = 0;
    const sidebar = document.getElementById('main-sidebar');
    if (!sidebar) return;
    sidebar.addEventListener('touchstart', (e) => {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
    }, { passive: true });
    sidebar.addEventListener('touchend', (e) => {
        const dx = e.changedTouches[0].clientX - touchStartX;
        const dy = Math.abs(e.changedTouches[0].clientY - touchStartY);
        // Swipe left more than 60px and mostly horizontal → close
        if (dx < -60 && dy < 80 && window.innerWidth < 768) {
            toggleSidebar();
        }
    }, { passive: true });
})();
