/* =========================================
   SETTINGS, THEMING & PERSONALIZATION ENGINE
   ========================================= */
function hexToRgbStr(hex) {
    let c = hex.replace('#', ''); if(c.length === 3) c = c.split('').map(x => x + x).join('');
    return `${parseInt(c.slice(0,2),16)} ${parseInt(c.slice(2,4),16)} ${parseInt(c.slice(4,6),16)}`;
}

function applySettings() {
    document.body.setAttribute('data-theme', state.settings.theme);
    document.documentElement.style.setProperty('--accent', hexToRgbStr(state.settings.accent));
    document.documentElement.style.setProperty('--glass-opacity', state.settings.glassOpacity);
    document.documentElement.style.setProperty('--glass-blur', state.settings.glassBlur + 'px');
    // Enable the blur compositor whenever blur is requested. Surface opacity is
    // kept below 1 so backdrop-filter has an actual translucent surface to work on.
    const blurEnabled = Number(state.settings.glassBlur) > 0;
    document.documentElement.classList.toggle('glass-blur-enabled', blurEnabled);
    document.documentElement.style.setProperty('--glass-surface-opacity', String(Math.min(0.96, Math.max(0.08, Number(state.settings.glassOpacity) || 0.8))));

    // Sync Form Elements
    if(document.getElementById(`theme-${state.settings.theme}`)) document.getElementById(`theme-${state.settings.theme}`).checked = true;
    document.getElementById('accent-picker').value = state.settings.accent;
    document.getElementById('accent-hex-display').innerText = state.settings.accent.toUpperCase();
    // Sync accent swatch
    const accentSwatch = document.getElementById('accent-picker-swatch');
    if (accentSwatch) accentSwatch.style.background = state.settings.accent;
    document.getElementById('wp-url').value = state.settings.wallpaper || '';
    document.getElementById('glass-opacity').value = state.settings.glassOpacity;
    crangeUpdate(document.getElementById('glass-opacity'));
    document.getElementById('glass-blur').value = state.settings.glassBlur;
    crangeUpdate(document.getElementById('glass-blur'));
    // Sync ambient sound custom select label
    const ambientVal = state.settings.ambientSound || 'none';
    document.getElementById('ambient-sound').value = ambientVal;
    const ambientLabels = {none:'None',rain:'Light Rain',fire:'Crackling Fireplace',cafe:'Cafe Murmur',forest:'Forest Birds'};
    const ambientLbl = document.getElementById('ambient-sound-btn')?.querySelector('.csel-label');
    if (ambientLbl) ambientLbl.textContent = ambientLabels[ambientVal] || 'None';
    document.getElementById('setting-blocklist').value = state.settings.blocklist;

    // Wallpaper Setup
    const bgImg = document.getElementById('bg-image');
    const bgVid = document.getElementById('bg-video');
    const bgUrl = String(state.settings.wallpaper || '').trim();
    const wpLabel = document.getElementById('wp-current-label');
    const showWallpaperError = (message) => {
        console.warn('[Graphite] Wallpaper failed:', message);
        if (wpLabel) wpLabel.textContent = state.settings.wallpaperIsLocal
            ? ('Local file failed: ' + (state.settings.wallpaperName || ''))
            : 'Wallpaper failed to load';
    };

    // Always reset both media elements before switching type. This prevents a
    // previously loaded video/image from remaining visible after changing or
    // clearing the wallpaper.
    bgImg.onload = null;
    bgImg.onerror = null;
    bgVid.onloadeddata = null;
    bgVid.onerror = null;
    bgImg.classList.add('hidden');
    bgVid.classList.add('hidden');
    bgVid.pause();
    bgVid.removeAttribute('src');
    bgVid.load();
    bgImg.removeAttribute('src');

    if (bgUrl) {
        const isVideo = state.settings.wallpaperType === 'video' ||
            /\.(mp4|webm|ogg)(?:[?#].*)?$/i.test(bgUrl) ||
            /^data:video\//i.test(bgUrl) ||
            /^blob:/i.test(bgUrl) && state.settings.wallpaperType === 'video';

        if (isVideo) {
            bgVid.onerror = () => showWallpaperError('video source could not be loaded');
            bgVid.onloadeddata = () => {
                bgVid.classList.remove('hidden');
                bgVid.play().catch(() => console.log('Video autoplay deferred until interaction'));
            };
            bgVid.src = bgUrl;
            bgVid.load();
        } else {
            bgImg.onerror = () => showWallpaperError('image source could not be loaded');
            bgImg.onload = () => bgImg.classList.remove('hidden');
            bgImg.src = bgUrl;
        }

        if (wpLabel) wpLabel.textContent = state.settings.wallpaperIsLocal
            ? ('Local file: ' + (state.settings.wallpaperName || ''))
            : bgUrl;
    } else if (wpLabel) {
        wpLabel.textContent = '';
    }
    const wpInput = document.getElementById('wp-url');
    if (wpInput) wpInput.value = state.settings.wallpaperIsLocal ? '' : bgUrl;

    // Ambient Sound Setup
    const audio = document.getElementById('ambient-player');
    const soundMap = {
        'rain': 'https://actions.google.com/sounds/v1/weather/rain_heavy_loud.ogg',
        'fire': 'https://actions.google.com/sounds/v1/nature/fire.ogg',
        'cafe': 'https://actions.google.com/sounds/v1/crowds/cafe_restaurant.ogg',
        'forest': 'https://actions.google.com/sounds/v1/nature/forest_birds.ogg'
    };
    if(state.settings.ambientSound && state.settings.ambientSound !== 'none') {
        if(audio.src !== soundMap[state.settings.ambientSound]) {
            audio.src = soundMap[state.settings.ambientSound];
            audio.play().catch(e => { console.log('Autoplay deferred until interaction'); });
        }
    } else { audio.pause(); audio.src = ''; }

    const preview = document.getElementById('markdown-preview');
    if(state.settings.theme === 'dark') preview.classList.add('prose-invert'); else preview.classList.remove('prose-invert');

    // Sync AI Provider settings
    const providerEl = document.getElementById('setting-ai-provider');
    const keyEl = document.getElementById('setting-openai-key');
    const baseEl = document.getElementById('setting-openai-base');
    if (providerEl) {
        const provider = state.settings.aiProvider || 'free';
        providerEl.value = provider;
        // sync custom select label
        const providerLabels = {
            free:'🆓 Free (Pollinations.ai — no key needed)',
            openai:'🤖 OpenAI (ChatGPT — gpt-4o-mini)',
            claude:'🟣 Anthropic (Claude)',
            gemini:'🔵 Google (Gemini)',
            custom:'⚙️ Custom endpoint'
        };
        const provLbl = document.getElementById('setting-ai-provider-btn')?.querySelector('.csel-label');
        if (provLbl) provLbl.textContent = providerLabels[provider] || providerLabels.free;
        // mark selected option
        document.querySelectorAll('#setting-ai-provider-dd .csel-option').forEach(o => o.classList.toggle('selected', o.dataset.val === provider));
        if (keyEl) keyEl.value = state.settings.openaiKey || '';
        if (baseEl) baseEl.value = state.settings.openaiBase || '';
        updateAiProviderUI(provider);
    }

    // Sync Focus-Aware toggle
    const faTog = document.getElementById('focus-aware-toggle');
    if (faTog) {
        faTog.checked = state.settings.focusAwareEnabled !== false;
        const trackEl = document.querySelector('.focus-aware-track');
        const thumbEl = document.querySelector('.focus-aware-thumb');
        const statusEl = document.getElementById('focus-aware-status');
        const enabled = state.settings.focusAwareEnabled !== false;
        if (trackEl) trackEl.style.backgroundColor = enabled ? 'rgb(var(--accent))' : '';
        if (thumbEl) thumbEl.style.transform = enabled ? 'translateX(24px)' : '';
        if (statusEl) statusEl.textContent = enabled ? 'On' : 'Off';
    }

    // Sync hover-draw key setting
    const hoverKeyEl = document.getElementById('setting-hover-draw-key');
    if (hoverKeyEl) hoverKeyEl.value = (state.settings.hoverDrawKey || 'f').toUpperCase();
    const refKbd = document.getElementById('shortcuts-hover-draw-key');
    if (refKbd) refKbd.textContent = (state.settings.hoverDrawKey || 'f').toUpperCase();
}

document.body.addEventListener('click', () => {
    const audio = document.getElementById('ambient-player');
    if (audio.src && audio.paused && state.settings.ambientSound !== 'none') audio.play();
}, { once: true });

function updateTheme(val) { state.settings.theme = val; saveDataToDB(); applySettings(); }
function updateAccent(hex) { state.settings.accent = hex; saveDataToDB(); applySettings(); }
function setPresetAccent(hex) { updateAccent(hex); }
function updateWallpaper(val) { updateWallpaperUrl(val); }
function updateGlassOpacity(val) { state.settings.glassOpacity = val; saveDataToDB(); applySettings(); }
function updateGlassBlur(val) { state.settings.glassBlur = val; saveDataToDB(); applySettings(); }
function updateAmbient(val) { state.settings.ambientSound = val; saveDataToDB(); applySettings(); }
function updateBlocklist(val) { state.settings.blocklist = val; saveDataToDB(); }

// ---- AI Provider Management ----
const AI_PROVIDER_META = {
    free:    { hint: '✅ No API key needed. Uses Pollinations.ai — free, unlimited, but slower.', showKey: false, showBase: false },
    openai:  { hint: '🔑 Paste your OpenAI API key (sk-...). Get one at platform.openai.com.', showKey: true, showBase: false },
    claude:  { hint: '🔑 Paste your Anthropic API key (sk-ant-...). Get one at console.anthropic.com.', showKey: true, showBase: false },
    gemini:  { hint: '🔑 Paste your Google AI Studio key. Get one at aistudio.google.com.', showKey: true, showBase: false },
    custom:  { hint: '⚙️ Enter your API key and the base URL of any OpenAI-compatible endpoint (e.g. LM Studio, Groq, Together AI).', showKey: true, showBase: true },
};
function updateAiProviderUI(provider) {
    const meta = AI_PROVIDER_META[provider] || AI_PROVIDER_META["free"];
    const keyBlock = document.getElementById("ai-key-block");
    const baseBlock = document.getElementById("ai-custom-base-block");
    const hint = document.getElementById("ai-provider-hint");
    if (keyBlock) keyBlock.style.display = meta.showKey ? "" : "none";
    if (baseBlock) baseBlock.classList.toggle("hidden", !meta.showBase);
    if (hint) hint.textContent = meta.hint;
}
function updateAiProvider(provider) {
    state.settings.aiProvider = provider;
    saveDataToDB();
    updateAiProviderUI(provider);
}

/* ════════════════════════════════════════════════════════════
   NEW FEATURES JS
   ════════════════════════════════════════════════════════════ */

// ── WORD COUNT ────────────────────────────────────────────────
function updateWordCount() {
    const ta = document.getElementById('note-body-raw');
    const el = document.getElementById('note-wordcount');
    if (!ta || !el) return;
    const text = ta.value.trim();
    if (!text) { el.classList.add('hidden'); return; }
    const words = text.split(/\s+/).filter(Boolean).length;
    const chars = text.length;
    const readMins = Math.max(1, Math.round(words / 200));
    el.textContent = `${words} words · ${chars} chars · ~${readMins} min read`;
    el.classList.remove('hidden');
}

// ── NOTE TEMPLATES ────────────────────────────────────────────
const NOTE_TEMPLATES = {
    'Lecture Notes': `# Lecture: {{title}}\n**Date:** {{date}}\n**Subject:** \n\n## Key Concepts\n- \n\n## Details\n\n\n## Questions to Follow Up\n- \n\n## Summary\n`,
    'Problem Set': `# Problem Set: {{title}}\n**Date:** {{date}}\n\n## Problems\n\n### Problem 1\n**Given:**\n\n**Find:**\n\n**Solution:**\n\n\n## Notes\n`,
    'Book Summary': `# Book Summary: {{title}}\n**Date:** {{date}}\n**Author:**\n\n## Core Thesis\n\n\n## Key Ideas\n1. \n2. \n3. \n\n## Quotes\n> \n\n## My Takeaways\n`,
    'Daily Log': `# Daily Log — {{date}}\n\n## Goals Today\n- [ ] \n\n## Notes\n\n\n## Reflections\n\n`,
    'Meeting / Discussion': `# Meeting: {{title}}\n**Date:** {{date}}\n**Attendees:**\n\n## Agenda\n- \n\n## Discussion Points\n\n\n## Action Items\n- [ ] \n`,
};

async function applyNoteTemplate() {
    const data = await showModal({
        title: 'Choose a Template',
        type: 'form',
        fields: [{ id: 'tpl', label: 'Template', type: 'select', options: Object.keys(NOTE_TEMPLATES) }]
    });
    if (!data || !data.tpl) return;
    const ta = document.getElementById('note-body-raw');
    const titleEl = document.getElementById('note-title');
    if (!ta) return;
    const today = new Date().toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });
    const title = titleEl?.value || 'Untitled';
    let tplBody = NOTE_TEMPLATES[data.tpl]
        .replace(/{{title}}/g, title)
        .replace(/{{date}}/g, today);
    if (ta.value.trim()) {
        ta.value = ta.value + '\n\n---\n\n' + tplBody;
    } else {
        ta.value = tplBody;
    }
    saveNotes(); updateLivePreview(); updateWordCount();
    toast(`Template "${data.tpl}" applied`);
}

// ── CANVAS EXPORT ─────────────────────────────────────────────
function exportCanvas() {
    const canvas = document.getElementById('whiteboard');
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = 'whiteboard-' + formatLocalDateKey() + '.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
    toast('Canvas exported as PNG');
}

// ── LOCAL WALLPAPER ───────────────────────────────────────────
function updateWallpaperUrl(val) {
    const url = String(val || '').trim();
    state.settings.wallpaper = url;
    state.settings.wallpaperIsLocal = false;
    state.settings.wallpaperName = '';
    state.settings.wallpaperType = /\.(mp4|webm|ogg)(?:[?#].*)?$/i.test(url) ? 'video' : '';
    saveDataToDB();
    applySettings();
}

function loadLocalWallpaper(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        state.settings.wallpaper = e.target.result;
        state.settings.wallpaperIsLocal = true;
        state.settings.wallpaperName = file.name;
        state.settings.wallpaperType = file.type.startsWith('video/') ? 'video' : 'image';
        saveDataToDB(); applySettings();
        toast('Wallpaper set: ' + file.name);
    };
    reader.readAsDataURL(file);
}

function clearWallpaper() {
    state.settings.wallpaper = '';
    state.settings.wallpaperIsLocal = false;
    state.settings.wallpaperName = '';
    state.settings.wallpaperType = '';
    saveDataToDB(); applySettings();
    toast('Wallpaper cleared');
}

// ── SESSION LOG ───────────────────────────────────────────────
function logSession(durationMins) {
    if (!state.sessionLog) state.sessionLog = [];
    const subject = document.getElementById('pomo-subject')?.value?.trim() || 'General';
    const currentNote = state.notes.find(n => n.id === state.currentNoteId);
    state.sessionLog.push({
        id: 'sess-' + Date.now(),
        date: todayKey(),
        subject,
        noteId: state.currentNoteId || null,
        noteTitle: currentNote?.title || null,
        duration: durationMins,
        pomodoros: 1,
        workspaceId: state.activeWorkspace
    });
    if (state.sessionLog.length > 500) state.sessionLog.shift();
    saveDataToDB();
    renderPomoRecentSessions();
}

async function addManualSession() {
    const data = await showModal({
        title: 'Log a Session',
        type: 'form',
        fields: [
            { id: 'subject', label: 'Subject', type: 'text' },
            { id: 'duration', label: 'Duration (minutes)', type: 'text' },
            { id: 'date', label: 'Date', type: 'date' }
        ]
    });
    if (!data || !data.subject) return;
    state.sessionLog.push({
        id: 'sess-' + Date.now(),
        date: data.date || todayKey(),
        subject: data.subject,
        noteId: null, noteTitle: null,
        duration: parseInt(data.duration) || 25,
        pomodoros: 1,
        workspaceId: state.activeWorkspace
    });
    saveDataToDB(); renderSessionLog();
    toast('Session logged');
}

function getWeekSessions() {
    if (!state.sessionLog) state.sessionLog = [];
    const now = new Date();
    const weekAgo = new Date(now); weekAgo.setDate(now.getDate() - 6);
    const weekKey = formatLocalDateKey(weekAgo);
    return state.sessionLog.filter(s =>
        s.workspaceId === state.activeWorkspace && s.date >= weekKey
    );
}

function renderSessionLog() {
    const sessions = state.sessionLog
        .filter(s => s.workspaceId === state.activeWorkspace)
        .slice().reverse();
    const filterVal = (document.getElementById('session-filter')?.value || '').toLowerCase();
    const filtered = filterVal ? sessions.filter(s => s.subject.toLowerCase().includes(filterVal)) : sessions;

    // Weekly subject bars
    const weekSessions = getWeekSessions();
    const subjectMap = {};
    weekSessions.forEach(s => {
        subjectMap[s.subject] = (subjectMap[s.subject] || 0) + (s.duration || 25);
    });
    const sortedSubjects = Object.entries(subjectMap).sort((a,b) => b[1]-a[1]);
    const maxMins = sortedSubjects[0]?.[1] || 1;
    const barsEl = document.getElementById('session-weekly-bars');
    const emptyEl = document.getElementById('session-weekly-empty');
    if (barsEl) {
        if (sortedSubjects.length === 0) {
            barsEl.innerHTML = '';
            emptyEl?.classList.remove('hidden');
        } else {
            emptyEl?.classList.add('hidden');
            const COLORS = ['#8b5cf6','#10b981','#f59e0b','#3b82f6','#f43f5e','#06b6d4'];
            barsEl.innerHTML = sortedSubjects.map(([subj, mins], i) => {
                const pct = Math.round((mins / maxMins) * 100);
                const h = Math.floor(mins/60), m = mins%60;
                const timeStr = h > 0 ? `${h}h ${m}m` : `${m}m`;
                return `<div>
                    <div class="flex justify-between text-xs mb-1">
                        <span class="text-textMain font-medium">${subj}</span>
                        <span class="text-textMuted font-mono">${timeStr}</span>
                    </div>
                    <div class="w-full bg-borderDark rounded-full h-2">
                        <div class="h-2 rounded-full transition-all duration-700" style="width:${pct}%;background:${COLORS[i%COLORS.length]}"></div>
                    </div>
                </div>`;
            }).join('');
        }
    }

    // Session table
    const tableEl = document.getElementById('session-log-table');
    if (tableEl) {
        if (filtered.length === 0) {
            tableEl.innerHTML = '<div class="p-8 text-center text-textMuted text-sm">No sessions yet. Complete a tagged Pomodoro to log one.</div>';
        } else {
            tableEl.innerHTML = filtered.map(s => {
                const h = Math.floor(s.duration/60), m = s.duration%60;
                const timeStr = h > 0 ? `${h}h ${m}m` : `${m}m`;
                return `<div class="flex items-center justify-between px-4 py-3 hover:bg-black/10 transition gap-3 flex-wrap">
                    <div class="flex items-center gap-3 min-w-0">
                        <span class="w-2 h-2 rounded-full bg-accent shrink-0"></span>
                        <div class="min-w-0">
                            <div class="text-sm font-medium text-textMain">${s.subject}</div>
                            ${s.noteTitle ? `<div class="text-[10px] text-accent truncate">📝 ${s.noteTitle}</div>` : ''}
                        </div>
                    </div>
                    <div class="flex items-center gap-4 shrink-0">
                        <span class="text-xs font-mono text-textMuted">${timeStr}</span>
                        <span class="text-[10px] text-textMuted">${s.date}</span>
                        <button onclick="deleteSession('${s.id}')" class="text-textMuted hover:text-red-400 transition text-xs px-1">✕</button>
                    </div>
                </div>`;
            }).join('');
        }
    }
}

function deleteSession(id) {
    state.sessionLog = state.sessionLog.filter(s => s.id !== id);
    saveDataToDB(); renderSessionLog();
}

function renderPomoRecentSessions() {
    const el = document.getElementById('pomo-recent-sessions');
    if (!el) return;
    const recent = state.sessionLog
        .filter(s => s.workspaceId === state.activeWorkspace)
        .slice(-5).reverse();
    if (recent.length === 0) { el.innerHTML = '<div class="text-xs text-textMuted italic">No sessions yet.</div>'; return; }
    el.innerHTML = recent.map(s => `
        <div class="flex items-center justify-between text-xs text-textMuted py-1 border-b border-borderDark/40">
            <span class="font-medium text-textMain">${s.subject}</span>
            <span class="font-mono">${s.duration}m · ${s.date}</span>
        </div>`).join('');
}

function renderSessionDashWidget() {
    if (!state.sessionLog) state.sessionLog = [];
    const weekSess = getWeekSessions();
    const dashEl = document.getElementById('session-breakdown-dash');
    const barsEl = document.getElementById('session-subject-bars');
    if (!dashEl || !barsEl) return;
    if (weekSess.length === 0) { dashEl.classList.add('hidden'); return; }
    dashEl.classList.remove('hidden');
    const subjectMap = {};
    weekSess.forEach(s => { subjectMap[s.subject] = (subjectMap[s.subject] || 0) + (s.duration || 25); });
    const sorted = Object.entries(subjectMap).sort((a,b) => b[1]-a[1]).slice(0,4);
    const maxM = sorted[0]?.[1] || 1;
    const COLORS = ['#8b5cf6','#10b981','#f59e0b','#3b82f6'];
    barsEl.innerHTML = sorted.map(([subj, mins], i) => {
        const pct = Math.round((mins/maxM)*100);
        const h = Math.floor(mins/60), m = mins%60;
        return `<div class="flex items-center gap-3">
            <span class="text-xs text-textMain w-20 truncate">${subj}</span>
            <div class="flex-1 bg-borderDark rounded-full h-1.5">
                <div class="h-1.5 rounded-full" style="width:${pct}%;background:${COLORS[i%4]}"></div>
            </div>
            <span class="text-[10px] text-textMuted font-mono w-10 text-right">${h>0?h+'h ':''} ${m}m</span>
        </div>`;
    }).join('');
}

// ── EXAM COUNTDOWNS ───────────────────────────────────────────
async function addExamCountdown() {
    const data = await showModal({
        title: 'Add Exam Countdown',
        type: 'form',
        fields: [
            { id: 'title', label: 'Exam Name', type: 'text' },
            { id: 'date', label: 'Exam Date', type: 'date' },
            { id: 'subject', label: 'Subject', type: 'text' }
        ]
    });
    if (!data || !data.title || !data.date) return;
    state.examCountdowns.push({
        id: 'exam-' + Date.now(),
        title: data.title,
        date: data.date,
        subject: data.subject || '',
        workspaceId: state.activeWorkspace
    });
    saveDataToDB(); renderExamCountdowns();
    toast('Exam countdown added');
}

function renderExamCountdowns() {
    if (!state.examCountdowns) state.examCountdowns = [];
    const exams = state.examCountdowns.filter(e => e.workspaceId === state.activeWorkspace);
    const rowEl = document.getElementById('exam-countdowns-row');
    const listEl = document.getElementById('exam-countdowns-list');
    if (!rowEl || !listEl) return;
    const today = new Date(); today.setHours(0,0,0,0);

    // Remove past exams older than 1 day
    const futureExams = exams.filter(e => {
        const d = new Date(e.date); d.setHours(0,0,0,0);
        return d >= new Date(today.getTime() - 86400000);
    });

    if (futureExams.length === 0) { rowEl.classList.add('hidden'); return; }
    rowEl.classList.remove('hidden');

    const PALETTE = ['border-accent/40 bg-accent/5', 'border-mint/40 bg-mint/5', 'border-orange-400/40 bg-orange-400/5', 'border-blue-400/40 bg-blue-400/5'];
    listEl.innerHTML = futureExams.map((e, i) => {
        const examDate = new Date(e.date); examDate.setHours(0,0,0,0);
        const diff = Math.round((examDate - today) / 86400000);
        const urgency = diff <= 3 ? 'text-red-400' : diff <= 7 ? 'text-orange-400' : 'text-mint';
        const label = diff === 0 ? 'Today!' : diff === 1 ? 'Tomorrow' : `${diff} days`;
        return `<div class="glass-sidebar border ${PALETTE[i%4]} rounded-xl p-4 flex flex-col min-w-[160px] relative group">
            <button onclick="deleteExam('${e.id}')" class="absolute top-2 right-2 text-textMuted/40 hover:text-red-400 opacity-0 group-hover:opacity-100 transition text-xs px-1">✕</button>
            <div class="text-[10px] text-textMuted uppercase tracking-wider mb-1">${e.subject || 'Exam'}</div>
            <div class="text-sm font-bold text-textMain mb-1 pr-4">${e.title}</div>
            <div class="text-2xl font-light ${urgency} mt-auto">${label}</div>
            <div class="text-[10px] text-textMuted mt-1">${e.date}</div>
        </div>`;
    }).join('');
}

function deleteExam(id) {
    state.examCountdowns = state.examCountdowns.filter(e => e.id !== id);
    saveDataToDB(); renderExamCountdowns();
}

// ── FLASHCARD STATS ───────────────────────────────────────────
function showFlashcardStats() {
    const panel = document.getElementById('srs-stats-panel');
    if (!panel) return;
    const isHidden = panel.classList.contains('hidden');
    panel.classList.toggle('hidden');
    if (!isHidden) return;

    const now = Date.now();
    const cards = state.flashcards.filter(c => c.workspaceId === state.activeWorkspace);
    const due = cards.filter(c => c.next <= now);
    const mature = cards.filter(c => c.rep >= 5);

    // Retention estimate: cards with ef > 2.0 and rep > 0 considered retained
    const reviewed = cards.filter(c => c.rep > 0);
    const retained = reviewed.filter(c => c.ef >= 2.0);
    const retention = reviewed.length > 0 ? Math.round((retained.length / reviewed.length) * 100) + '%' : '—';

    document.getElementById('srs-stat-total').textContent = cards.length;
    document.getElementById('srs-stat-due').textContent = due.length;
    document.getElementById('srs-stat-retention').textContent = retention;
    document.getElementById('srs-stat-mature').textContent = mature.length;

    // Weakest cards (lowest ease factor, min 3 reviews)
    const weakCards = cards.filter(c => c.rep >= 3).sort((a,b) => a.ef - b.ef).slice(0,5);
    const weakEl = document.getElementById('srs-weak-cards');
    if (weakEl) {
        weakEl.innerHTML = weakCards.length === 0
            ? '<div class="text-xs text-textMuted italic">No mature cards yet.</div>'
            : weakCards.map(card => `
                <div class="flex items-center justify-between p-2 glass-bg rounded border border-borderDark text-xs">
                    <span class="text-textMain truncate mr-3">${card.q.length > 50 ? card.q.slice(0,50) + '…' : card.q}</span>
                    <span class="text-red-400 font-mono shrink-0">EF ${card.ef.toFixed(2)}</span>
                </div>`).join('');
    }
}

// ── FULL-TEXT SEARCH ──────────────────────────────────────────
let ftsDebounce = null;
