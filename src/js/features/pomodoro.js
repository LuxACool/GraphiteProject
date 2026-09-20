let tSeconds = 1500, tInterval = null, tMode = 'work', isFocusMode = false;
let focusParticleReq;

function updateTimerUI() {
    const m = Math.floor(tSeconds / 60).toString().padStart(2, '0'); const s = (tSeconds % 60).toString().padStart(2, '0');
    document.getElementById('timer-display').innerText = `${m}:${s}`; 
    document.getElementById('mini-timer').innerText = `${m}:${s}`;
    document.getElementById('focus-timer-display').innerText = `${m}:${s}`;
    // Animate SVG ring
    const total = tMode === 'work' ? 1500 : 300;
    const pct = tSeconds / total;
    const ring = document.getElementById('pomo-ring-fill');
    if (ring) {
        const circ = 703.7;
        ring.style.strokeDashoffset = circ * (1 - pct);
    }
    // Update dots
    renderPomoDots();
}



/* ── CONFETTI BURST ── */
function confettiBurst() {
    const colors = ['rgb(var(--accent))', '#10b981', '#f59e0b', '#3b82f6', '#f43f5e'];
    const frag = document.createDocumentFragment();
    for (let i = 0; i < 24; i++) {  // was 60 — 24 is plenty visible
        const el = document.createElement('div');
        el.style.cssText = `position:fixed;top:50%;left:50%;width:8px;height:8px;border-radius:2px;
            background:${colors[i % colors.length]};pointer-events:none;z-index:99999;
            transform:translate(-50%,-50%);`;
        const angle = (Math.PI * 2 * i) / 24;
        const distance = 80 + Math.random() * 150;
        const dx = Math.cos(angle) * distance;
        const dy = Math.sin(angle) * distance - 80;
        el.animate([
            { transform: 'translate(-50%,-50%) rotate(0deg)', opacity: 1 },
            { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) rotate(${Math.random()*360}deg)`, opacity: 0 }
        ], { duration: 700, easing: 'cubic-bezier(0,0,.58,1)', fill: 'forwards' })
        .onfinish = () => el.remove();
        frag.appendChild(el);
    }
    document.body.appendChild(frag);
}

/* ── POMODORO DOTS ── */
function renderPomoDots() {
    const el = document.getElementById('pomo-dots');
    if (!el) return;
    const count = Math.min(state.pomodoroCount % 4 || 4, 4);
    el.innerHTML = Array.from({length: 4}, (_, i) =>
        `<span class="pomo-segment ${i < (state.pomodoroCount % 4 === 0 && state.pomodoroCount > 0 ? 4 : state.pomodoroCount % 4) ? 'done' : ''}"></span>`
    ).join('');
}

/* ── READING PROGRESS BAR — single delegated listener ── */
function initReadingProgress() {
    // One passive listener on the content area, not one per module
    const content = document.querySelector('.flex-1.overflow-hidden.relative');
    if (!content) return;
    content.addEventListener('scroll', (e) => {
        const bar = document.getElementById('page-progress');
        if (!bar) return;
        const el = e.target;
        if (!el || !el.classList?.contains('app-module')) return;
        const scrollHeight = el.scrollHeight - el.clientHeight;
        bar.style.width = scrollHeight > 0 ? (el.scrollTop / scrollHeight * 100) + '%' : '0%';
    }, { passive: true, capture: true });
}

/* ── NOTE LIST: add active class ── */
function highlightActiveNote() {
    document.querySelectorAll('.note-item').forEach(el => el.classList.remove('active-note'));
    const active = document.querySelector(`.note-item[data-id="${state.currentNoteId}"]`);
    if (active) active.classList.add('active-note');
}

// FEATURE: Ambient Dust Overlay Logic — CSS-only, no rAF loop
function initFocusParticles() {
    const canvas = document.getElementById('focus-canvas');
    if (!canvas) return;
    // Use CSS particles on a sibling div instead of a canvas rAF loop
    let cssLayer = document.getElementById('focus-css-particles');
    if (!cssLayer) {
        cssLayer = document.createElement('div');
        cssLayer.id = 'focus-css-particles';
        cssLayer.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;';
        canvas.parentNode.insertBefore(cssLayer, canvas);
    }
    cssLayer.innerHTML = '';
    for (let i = 0; i < 20; i++) {
        const dot = document.createElement('span');
        const size = (Math.random() * 3 + 1).toFixed(1);
        const left = (Math.random() * 100).toFixed(1);
        const dur  = (6 + Math.random() * 10).toFixed(1);
        const delay = (Math.random() * -12).toFixed(1);
        dot.style.cssText = `
            position:absolute;
            left:${left}%;
            bottom:-10px;
            width:${size}px;height:${size}px;
            border-radius:50%;
            background:rgba(255,255,255,0.35);
            animation:particleRise ${dur}s ${delay}s linear infinite;
        `;
        cssLayer.appendChild(dot);
    }
    // Hide actual canvas — no drawing needed
    canvas.style.display = 'none';
}

function toggleFocusMode(active) {
    isFocusMode = active;
    if(active) {
        document.body.classList.add('focus-mode');
        if(currentApp !== 'pomodoro') document.getElementById('mini-timer').classList.remove('hidden');
        initFocusParticles();
        if (state.settings.focusAwareEnabled) showFocusSuggestionsPanel();
    } else {
        document.body.classList.remove('focus-mode');
        document.getElementById('mini-timer').classList.add('hidden');
        // Remove CSS particle layer
        const layer = document.getElementById('focus-css-particles');
        if (layer) layer.remove();
        const canvas = document.getElementById('focus-canvas');
        if (canvas) canvas.style.display = '';
        hideFocusSuggestionsPanel();
    }
}

function startTimer() {
    if (tInterval) return; 
    toggleFocusMode(true);
    if (state.settings.focusAwareEnabled) { setTimeout(refreshFocusSuggestions, 500); } 
    const durationMins = tCustomMins !== null ? tCustomMins : (tMode === 'work' ? 25 : 5);

    // Show Focus Overlay
    const overlay = document.getElementById('focus-overlay');
    document.getElementById('focus-task-display').innerText = state.goal || "Deep Work Session";
    document.getElementById('focus-blocklist-display').innerText = state.settings.blocklist || "Distracting websites";
    overlay.style.display = 'flex';
    overlay.style.flexDirection = 'column';

    // Audio Playback
    const audio = document.getElementById('ambient-player');
    if(audio.src && audio.paused && state.settings.ambientSound !== 'none') audio.play().catch(e=>{});

    tInterval = setInterval(() => {
        if (tSeconds > 0) { tSeconds--; updateTimerUI(); } 
        else {
            clearInterval(tInterval); tInterval = null; toggleFocusMode(false);
            if(tMode === 'work') { 
                state.pomodoroCount++; trackActivity('pomodoros'); 
                const ws = state.workspaces.find(w => w.id === state.activeWorkspace); if(ws) ws.focusMinutes = (ws.focusMinutes || 0) + durationMins;
                logSession(durationMins);
                saveDataToDB();
                if (currentApp === 'dashboard') { calculateStreak(); }
            }
            const _ov1 = document.getElementById('focus-overlay'); _ov1.style.display = ''; _ov1.classList.add('hidden');
            toast(" Work session complete! Time to take a break.", "success"); renderPomoDots(); confettiBurst();
            resetTimer();
        }
    }, 1000);
}

async function attemptEarlyExit() {
    if(await showModal({
        title: 'Break Focus Guard?', 
        content: 'You still have time remaining. Breaking focus now will discard this session.', 
        type: 'confirm'
    })) {
        clearInterval(tInterval); tInterval = null; toggleFocusMode(false);
        tSeconds = _pomoDefaultSecs();
        updateTimerUI();
        const _ov2 = document.getElementById('focus-overlay'); _ov2.style.display = ''; _ov2.classList.add('hidden');
    }
}

let tCustomMins = null; // null = use preset default

function _pomoDefaultSecs() {
    if (tCustomMins !== null) return tCustomMins * 60;
    return tMode === 'work' ? 1500 : tMode === 'long' ? 900 : 300;
}

function setTimerPreset(mins, mode) {
    tMode = mode;
    tCustomMins = mins;
    tSeconds = mins * 60;
    // Update active state on buttons
    document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('pomo-preset-active', 'text-accent', 'text-textMain'));
    const activeId = `preset-btn-${mins}`;
    const activeBtn = document.getElementById(activeId);
    if (activeBtn) { activeBtn.classList.add('pomo-preset-active', 'text-accent'); }
    // Update mode label
    const label = document.getElementById('pomo-mode-label');
    if (label) label.textContent = mode === 'work' ? `Work · ${mins}m` : `Break · ${mins}m`;
    // Clear custom input
    const inp = document.getElementById('custom-timer-input');
    if (inp) inp.value = '';
    pauseTimer();
    updateTimerUI();
}

function applyCustomTimer() {
    const inp = document.getElementById('custom-timer-input');
    const val = parseInt(inp.value);
    if (!val || val < 1 || val > 360) { toast('Enter a time between 1–360 minutes.', 'error'); return; }
    tCustomMins = val;
    tSeconds = val * 60;
    // Deactivate presets
    document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('pomo-preset-active', 'text-accent'));
    const label = document.getElementById('pomo-mode-label');
    if (label) label.textContent = `Custom · ${val}m`;
    pauseTimer();
    updateTimerUI();
    toast(`Timer set to ${val} minutes.`);
}

function setTimerMode(mode) {
    tMode = mode; tCustomMins = null;
    tSeconds = _pomoDefaultSecs();
    const label = document.getElementById('pomo-mode-label');
    if (label) label.textContent = mode === 'work' ? 'Work' : 'Break';
    updateTimerUI();
}

function pauseTimer() { clearInterval(tInterval); tInterval = null; toggleFocusMode(false); }
function resetTimer() { pauseTimer(); tSeconds = _pomoDefaultSecs(); updateTimerUI(); }

/* --- CALENDAR --- */
// Calendar UI/storage is implemented by js/pages/calendar.js.
// Keeping calendar state there prevents two competing implementations.

