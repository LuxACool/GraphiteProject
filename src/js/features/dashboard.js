/* --- DASHBOARD: DAILY DIGEST, STREAK, D3 HEATMAP & PIE --- */
function calculateStreak() {
    const history = state.activityHistory || {};

    // Build a date-keyed set of active days (any pomodoro or task)
    const isActive = (dStr) => {
        const d = history[dStr];
        return d && (d.pomodoros > 0 || d.tasks > 0);
    };

    const dateStr = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

    const today = new Date();
    today.setHours(0,0,0,0);

    // ── Current streak (walk backwards from today) ──────────────
    let current = 0;
    for (let i = 0; i < 365; i++) {
        const d = new Date(today); d.setDate(today.getDate() - i);
        if (isActive(dateStr(d))) current++;
        else if (i > 0) break; // gap found — only allow today to be empty
    }
    // If today has no activity yet, don't break streak from yesterday
    if (!isActive(dateStr(today))) {
        current = 0;
        for (let i = 1; i < 365; i++) {
            const d = new Date(today); d.setDate(today.getDate() - i);
            if (isActive(dateStr(d))) current++;
            else break;
        }
    }

    // ── Longest streak ───────────────────────────────────────────
    let best = 0, run = 0;
    // Scan all keys + fill gaps; use 400 day window
    for (let i = 399; i >= 0; i--) {
        const d = new Date(today); d.setDate(today.getDate() - i);
        if (isActive(dateStr(d))) { run++; if (run > best) best = run; }
        else run = 0;
    }

    // ── This month active days ───────────────────────────────────
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    let monthDays = 0;
    for (let i = 0; i < 31; i++) {
        const d = new Date(monthStart); d.setDate(1 + i);
        if (d > today) break;
        if (isActive(dateStr(d))) monthDays++;
    }

    // ── Total pomodoros & focus time from sessionLog ─────────────
    const sessions = state.sessionLog || [];
    const totalPomos = sessions.length;
    const totalMins  = sessions.reduce((acc, s) => acc + (s.duration || 25), 0);
    const totalFocusLabel = totalMins >= 60
        ? `${Math.floor(totalMins/60)}h`
        : `${totalMins}m`;

    // ── Last 7 days dot row ──────────────────────────────────────
    const accentRaw = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    const [ar, ag, ab] = accentRaw.split(' ').map(Number);
    const weekDotsEl = document.getElementById('streak-week-dots');
    if (weekDotsEl) {
        weekDotsEl.innerHTML = '';
        for (let i = 6; i >= 0; i--) {
            const d = new Date(today); d.setDate(today.getDate() - i);
            const dStr = dateStr(d);
            const active = isActive(dStr);
            const isToday = i === 0;
            const dayLabel = ['Su','Mo','Tu','We','Th','Fr','Sa'][d.getDay()];
            const val = active ? ((history[dStr]?.pomodoros || 0) + (history[dStr]?.tasks || 0)) : 0;
            const intensity = val === 0 ? 0 : val <= 2 ? 0.35 : val <= 5 ? 0.65 : 1;

            const dot = document.createElement('div');
            dot.className = 'flex flex-col items-center gap-1 flex-1';
            dot.innerHTML = `
                <div class="w-full aspect-square rounded-lg transition-all" style="background:${active ? `rgba(${ar},${ag},${ab},${intensity})` : 'rgba(100,100,100,0.12)'}; ${isToday ? `box-shadow:0 0 0 1.5px rgba(${ar},${ag},${ab},0.6)` : ''}"></div>
                <span class="text-[9px] text-textMuted font-mono">${dayLabel}</span>
            `;
            dot.title = `${dStr}: ${val} activities`;
            weekDotsEl.appendChild(dot);
        }
    }

    // ── Streak message ────────────────────────────────────────────
    const messages = {
        0:  "Start a session today to begin your streak.",
        1:  "Good start! Come back tomorrow to build momentum.",
        3:  "Three days in — the habit is forming.",
        7:  "One week strong! 🎯 Keep it going.",
        14: "Two weeks — consistency is a superpower.",
        30: "30 days! You're unstoppable. 🏆",
        60: "Two months of deep work. Legendary. 🔥",
    };
    const msgKey = [60,30,14,7,3,1,0].find(k => current >= k);
    const msgEl = document.getElementById('streak-message');
    if (msgEl) msgEl.textContent = messages[msgKey] || '';

    // ── Write to DOM ──────────────────────────────────────────────
    const el = id => document.getElementById(id);
    if (el('streak-count')) el('streak-count').textContent = current;
    if (el('streak-best'))  el('streak-best').textContent  = best;
    if (el('streak-month')) el('streak-month').textContent = monthDays;
    if (el('streak-total-sessions')) el('streak-total-sessions').textContent = totalPomos;
    if (el('streak-total-focus'))    el('streak-total-focus').textContent    = totalFocusLabel;

    // Flame animation — pulse when streak is alive
    const flame = el('streak-flame');
    if (flame) {
        flame.textContent = current >= 7 ? '🔥🔥' : current >= 3 ? '🔥' : current >= 1 ? '✨' : '💤';
        flame.style.animation = current > 0 ? 'flameFlicker 2s ease-in-out infinite' : 'none';
    }

    // Colour the streak number by milestone
    const countEl = el('streak-count');
    if (countEl) {
        countEl.style.color = current >= 3
            ? `rgb(${ar},${ag},${ab})`
            : 'rgb(var(--text-main))';
    }

    return current;
}

function updateDashboard() {
    // Smart greeting
    const hr = new Date().getHours();
    const greetings = hr < 5 ? ["Late night grind.", "Burning the midnight oil."] :
                      hr < 12 ? ["Good morning.", "Fresh start today."] :
                      hr < 17 ? ["Good afternoon.", "Keep the momentum."] :
                      hr < 20 ? ["Good evening.", "Winding down well."] :
                      ["Good night.", "One last session."];
    const g = document.getElementById('dash-greeting');
    const s = document.getElementById('dash-subtext');
    if (g) g.textContent = greetings[0];
    if (s) {
        const wsNotes2 = state.notes.filter(n => n.workspaceId === state.activeWorkspace);
        const dueCards = state.flashcards.filter(c => c.workspaceId === state.activeWorkspace && c.next <= Date.now());
        const pending = state.kanban.todo.filter(t => t.workspaceId === state.activeWorkspace).length;
        const parts = [];
        if (dueCards.length) parts.push(`${dueCards.length} cards due`);
        if (pending) parts.push(`${pending} tasks pending`);
        if (wsNotes2.length) parts.push(`${wsNotes2.length} notes`);
        s.textContent = parts.length ? parts.join(' · ') : greetings[1] || 'Here is your cognitive output.';
    }
    const wsTasks = state.kanban.todo.filter(t => t.workspaceId === state.activeWorkspace).length + state.kanban.progress.filter(t => t.workspaceId === state.activeWorkspace).length;
    document.getElementById('digest-tasks').innerText = wsTasks;

    const now = Date.now();
    const wsCards = state.flashcards.filter(c => c.workspaceId === state.activeWorkspace);
    document.getElementById('digest-srs').innerText = wsCards.filter(c => c.next <= now).length;

    const activeWs = state.workspaces.find(w => w.id === state.activeWorkspace);
    const focusMins = activeWs ? (activeWs.focusMinutes || 0) : 0;
    const focusEl = document.getElementById('digest-focus');
    if (focusEl) focusEl.innerText = focusMins >= 60 ? `${Math.floor(focusMins/60)}h ${focusMins%60}m` : `${focusMins}m`;

    const wsNotes = state.notes.filter(n => n.workspaceId === state.activeWorkspace);
    // Update synthesis card
    updateSynthesisCard();

    // Recent notes widget
    const recentEl = document.getElementById('dash-recent-notes');
    if (recentEl) {
        const recent = wsNotes.slice(0, 5);
        recentEl.innerHTML = recent.length === 0
            ? '<p class="text-xs text-textMuted/60 italic">No notes yet.</p>'
            : recent.map(n => `<div onclick="switchApp('notes'); setTimeout(()=>loadNoteIntoEditor('${n.id}'),80)" class="flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-black/10 cursor-pointer transition group">
                <div class="w-1.5 h-1.5 rounded-full bg-accent/50 shrink-0 group-hover:bg-accent transition"></div>
                <span class="text-xs text-textMain truncate">${n.title || 'Untitled'}</span>
                <span class="text-[10px] text-textMuted/50 ml-auto shrink-0">${n.timestamp || ''}</span>
            </div>`).join('');
    }

    calculateStreak();
    renderPieChart(wsNotes.length, state.kanban.done.filter(t => t.workspaceId === state.activeWorkspace).length);
    updateKSSMiniCard();
    renderExamCountdowns();
    renderSessionDashWidget();
}


function renderPieChart(noteCount, doneTaskCount) {
    const container = document.getElementById('pie-chart-container'); container.innerHTML = '';
    if(noteCount === 0 && doneTaskCount === 0) {
        container.innerHTML = '<div class="absolute inset-0 flex items-center justify-center text-textMuted text-xs text-center p-4">No data yet.</div>';
        document.getElementById('pie-legend').innerHTML = ''; return;
    }
    const data = [{ label: 'Tasks', val: doneTaskCount, color: '#10b981' }, { label: 'Notes', val: noteCount, color: '#f59e0b' }].filter(d => d.val > 0);
    const width = container.clientWidth || 160, height = container.clientHeight || 160, radius = Math.min(width, height) / 2;
    const svg = d3.select("#pie-chart-container").append("svg").attr("width", width).attr("height", height).append("g").attr("transform", `translate(${width/2},${height/2})`);
    const pie = d3.pie().value(d => d.val); const arc = d3.arc().innerRadius(radius * 0.5).outerRadius(radius * 0.9);
    svg.selectAll('path').data(pie(data)).enter().append('path').attr('d', arc).attr('fill', d => d.data.color)
        .attr('stroke', 'rgba(255,255,255,0.1)').style('stroke-width', '2px').style('opacity', 0.9)
        .on('mouseover', function(){ d3.select(this).style('opacity', 1); }).on('mouseout', function(){ d3.select(this).style('opacity', 0.9); });
    document.getElementById('pie-legend').innerHTML = data.map(d => `<div class="flex items-center gap-1 whitespace-nowrap"><span class="w-3 h-3 rounded-full" style="background:${d.color}"></span> ${d.label}</div>`).join('');
}

