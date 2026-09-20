/* ============================================================
   NotifSystem — dedicated notification module
   ============================================================ */
const NotifSystem = (() => {

    const TYPE_META = {
        srReview:     { label: 'Spaced Repetition & Quiz Reviews', icon: '🧠', desc: 'Flashcards due for review based on their SM-2 interval.' },
        focusHabit:   { label: 'Focus & Habit Reminders',          icon: '⏱️', desc: 'Scheduled study blocks starting soon, break timers, and daily focus goal progress.' },
        taskDeadline: { label: 'Task Deadlines & Daily Digest',    icon: '✅', desc: 'Kanban tasks approaching their due date, plus a morning summary.' },
        calendarAlert:{ label: 'Calendar Event Alerts',            icon: '📅', desc: 'Pre-event countdowns (e.g. 15m / 1h before a scheduled block).' },
        inactiveNotes:{ label: 'Inactive Note Follow-ups',         icon: '🗒️', desc: 'Notes that are unlinked or untouched for 14+ days.' }
    };

    const DEFAULTS = {
        masterEnabled: true,
        useBrowserNotifications: true,
        types: {
            srReview:      { enabled: true,  mode: 'batch' },       // batch = one digest; immediate = fire as soon as due
            focusHabit:    { enabled: true },
            taskDeadline:  { enabled: true, digestEnabled: true, digestTime: '08:00', leadHours: 24 },
            calendarAlert: { enabled: true, leadMinutes: [15, 60] },
            inactiveNotes: { enabled: true, thresholdDays: 14, digestTime: '09:00' }
        },
        digest: { srDigestTime: '08:30' },
        quietHours: { enabled: false, start: '22:00', end: '07:00' }
    };

    function ensureDefaults() {
        if (!state.settings) state.settings = {};
        if (!state.settings.notifications) {
            state.settings.notifications = JSON.parse(JSON.stringify(DEFAULTS));
        } else {
            // shallow-merge in any new keys added by later versions of this module
            const cur = state.settings.notifications;
            cur.masterEnabled = cur.masterEnabled !== undefined ? cur.masterEnabled : DEFAULTS.masterEnabled;
            cur.useBrowserNotifications = cur.useBrowserNotifications !== undefined ? cur.useBrowserNotifications : true;
            cur.types = cur.types || {};
            Object.keys(DEFAULTS.types).forEach(k => {
                cur.types[k] = { ...DEFAULTS.types[k], ...(cur.types[k] || {}) };
            });
            cur.digest = { ...DEFAULTS.digest, ...(cur.digest || {}) };
            cur.quietHours = { ...DEFAULTS.quietHours, ...(cur.quietHours || {}) };
        }
        // internal bookkeeping (not user-facing prefs, but persisted so we
        // don't re-notify after a reload)
        if (!state.settings.notifications._log) state.settings.notifications._log = {};
        return state.settings.notifications;
    }

    function prefs() { return ensureDefaults(); }

    // ---------- quiet hours ----------
    function inQuietHours() {
        const qh = prefs().quietHours;
        if (!qh.enabled) return false;
        const now = new Date();
        const cur = now.getHours() * 60 + now.getMinutes();
        const [sh, sm] = qh.start.split(':').map(Number);
        const [eh, em] = qh.end.split(':').map(Number);
        const start = sh * 60 + sm, end = eh * 60 + em;
        return start < end ? (cur >= start && cur < end) : (cur >= start || cur < end);
    }

    // ---------- de-dupe log (persisted in state so it survives reloads) ----------
    function alreadySent(key) { return !!prefs()._log[key]; }
    function markSent(key) { prefs()._log[key] = Date.now();
        // trim log so it doesn't grow forever (keep 30 days)
        const cutoff = Date.now() - 30 * 86400000;
        Object.keys(prefs()._log).forEach(k => { if (prefs()._log[k] < cutoff) delete prefs()._log[k]; });
    }

    // ---------- delivery: native notifications w/ toast fallback ----------
    // Three environments this needs to work in:
    //  1. Tauri v2 desktop build  -> use window.__TAURI__.notification
    //     (requires the notification plugin registered on the Rust side,
    //     "withGlobalTauri": true in tauri.conf.json, and the
    //     notification:default capability — see integration notes).
    //     The plain web Notification API is NOT reliable inside Tauri's
    //     webview (WebView2/WebKitGTK/WKWebView don't consistently
    //     implement it), so Tauri is checked first.
    //  2. Plain browser (testing/preview) -> window.Notification.
    //  3. Anything else / permission denied -> in-app toast.
    function isTauri() { return typeof window !== 'undefined' && !!window.__TAURI__; }

    // Cached synchronously-readable permission state. Tauri's permission
    // check is async, so we refresh this cache on init/after requests and
    // read the cached value everywhere notify() needs a quick decision.
    let _permCache = 'default';

    async function refreshPermissionCache() {
        try {
            if (isTauri()) {
                if (!window.__TAURI__.notification) { _permCache = 'unsupported'; }
                else {
                    const granted = await window.__TAURI__.notification.isPermissionGranted();
                    _permCache = granted ? 'granted' : 'default';
                }
            } else if ('Notification' in window) {
                _permCache = Notification.permission;
            } else {
                _permCache = 'unsupported';
            }
        } catch (e) { _permCache = 'unsupported'; }
        renderPermBadge();
        return _permCache;
    }

    function permissionState() { return _permCache; } // synchronous read of the cache

    async function requestPermission() {
        if (isTauri()) {
            if (!window.__TAURI__.notification) {
                toast('Notification plugin not registered in this build — see setup notes.', 'error');
                return 'unsupported';
            }
            try {
                const already = await window.__TAURI__.notification.isPermissionGranted();
                let perm = already ? 'granted' : await window.__TAURI__.notification.requestPermission();
                _permCache = perm;
                renderPermBadge();
                if (perm === 'granted') toast('Notifications enabled', 'success');
                else toast('Notifications blocked — falling back to in-app alerts', 'info');
                return perm;
            } catch (e) { _permCache = 'denied'; renderPermBadge(); return 'denied'; }
        }
        if (!('Notification' in window)) { toast('Browser notifications are not supported here.', 'error'); return 'unsupported'; }
        if (Notification.permission === 'granted') { _permCache = 'granted'; return 'granted'; }
        try {
            const perm = await Notification.requestPermission();
            _permCache = perm;
            renderPermBadge();
            if (perm === 'granted') toast('Browser notifications enabled', 'success');
            else if (perm === 'denied') toast('Notifications blocked — falling back to in-app alerts', 'info');
            return perm;
        } catch (e) { return 'denied'; }
    }

    // Fires the platform-native notification. Returns true if it was
    // dispatched, false if the caller should fall back to a toast.
    // Note: unlike the web Notification API, the Tauri plugin's
    // sendNotification() does not give us a reliable in-JS click
    // callback across platforms, so native notifications are used purely
    // as an ambient ping — click-to-navigate is handled by the in-app
    // toast path instead.
    async function fireNativeNotification(title, body) {
        try {
            if (isTauri()) {
                if (!window.__TAURI__.notification) return false;
                await window.__TAURI__.notification.sendNotification({ title, body: body || '' });
                return true;
            }
            if ('Notification' in window) {
                new Notification(title, { body: body || '' });
                return true;
            }
        } catch (e) { /* fall through to toast */ }
        return false;
    }

    // Rich in-app toast used as fallback and for anything the browser
    // Notification API can't do while the tab is focused/visible.
    function showInAppToast(typeKey, title, body, onClick) {
        const stack = document.getElementById('notif-toast-stack');
        if (!stack) { toast(title, 'info'); return; }
        const meta = TYPE_META[typeKey] || { icon: '🔔' };
        const el = document.createElement('div');
        el.className = 'notif-toast';
        el.innerHTML =
            '<div class="nt-icon">' + meta.icon + '</div>' +
            '<div style="flex:1;min-width:0;">' +
                '<div class="nt-title"></div>' +
                '<div class="nt-body"></div>' +
            '</div>' +
            '<div class="nt-close">✕</div>';
        el.querySelector('.nt-title').textContent = title;
        el.querySelector('.nt-body').textContent = body || '';
        el.querySelector('.nt-close').addEventListener('click', (e) => { e.stopPropagation(); dismiss(); });
        el.addEventListener('click', () => { if (onClick) onClick(); dismiss(); });
        stack.appendChild(el);
        requestAnimationFrame(() => el.classList.add('show'));
        const timer = setTimeout(dismiss, 8000);
        function dismiss() { clearTimeout(timer); el.classList.remove('show'); setTimeout(() => el.remove(), 250); }
    }

    async function notify(typeKey, title, body, opts) {
        opts = opts || {};
        const p = prefs();
        if (!p.masterEnabled) return;
        if (!p.types[typeKey] || !p.types[typeKey].enabled) return;
        if (inQuietHours() && !opts.ignoreQuietHours) return;
        if (opts.dedupeKey) {
            if (alreadySent(opts.dedupeKey)) return;
            markSent(opts.dedupeKey);
        }

        const wantsNative = p.useBrowserNotifications && permissionState() === 'granted';
        // Only fire a native OS notification when the window is hidden —
        // while the user is looking at the app, an in-app toast is less
        // intrusive and guarantees onClick works everywhere (native
        // click callbacks aren't reliable across Tauri's platforms).
        let delivered = false;
        if (wantsNative && document.visibilityState === 'hidden') {
            delivered = await fireNativeNotification(title, body);
        }
        if (!delivered) {
            showInAppToast(typeKey, title, body, opts.onClick);
        }
        saveDataToDB();
    }

    // ================= CHECK ROUTINES =================

    function checkSpacedRepetition() {
        const cards = (state.flashcards || []).filter(c => c.workspaceId === state.activeWorkspace && c.next <= Date.now());
        if (!cards.length) return;
        const cfg = prefs().types.srReview;
        if (cfg.mode === 'immediate') {
            cards.forEach(c => notify('srReview', 'Card due for review', (c.q || '').slice(0, 80),
                { dedupeKey: 'sr-' + c.id, onClick: () => switchApp && switchApp('flashcards') }));
        } else {
            const today = todayKey();
            notify('srReview', `${cards.length} flashcard${cards.length > 1 ? 's' : ''} due`,
                'Tap to start your review session.',
                { dedupeKey: 'sr-digest-' + today, onClick: () => switchApp && switchApp('flashcards') });
        }
    }

    function checkFocusHabit() {
        // Upcoming scheduled study/focus blocks starting within the next 5 minutes
        const ws = (state.calendarBlocks || {})[state.activeWorkspace] || {};
        const today = todayKey();
        const blocks = ws[today] || [];
        const now = new Date();
        const nowMin = now.getHours() * 60 + now.getMinutes();
        blocks.forEach(b => {
            if (!b.start) return;
            const [h, m] = b.start.split(':').map(Number);
            const blockMin = h * 60 + m;
            if (blockMin - nowMin <= 5 && blockMin - nowMin >= 0) {
                notify('focusHabit', 'Study block starting soon', (b.title || 'Focus block') + ' at ' + b.start,
                    { dedupeKey: 'focus-block-' + today + '-' + b.id });
            }
        });
        // Daily focus goal nudge, once/day at 20:00 if goal minutes not hit
        if (now.getHours() === 20 && now.getMinutes() < 5) {
            const wsObj = (state.workspaces || []).find(w => w.id === state.activeWorkspace);
            if (wsObj) {
                notify('focusHabit', 'Focus goal check-in', `You've logged ${wsObj.focusMinutes || 0} min today.`,
                    { dedupeKey: 'focus-goal-' + today });
            }
        }
    }

    function checkTaskDeadlines() {
        const cfg = prefs().types.taskDeadline;
        const tasks = [...(state.kanban.todo || []), ...(state.kanban.progress || [])]
            .filter(t => t.workspaceId === state.activeWorkspace && t.due);
        const now = Date.now();
        const leadMs = (cfg.leadHours || 24) * 3600000;

        // Immediate "approaching deadline" pings
        tasks.forEach(t => {
            const dueTime = new Date(t.due).getTime();
            if (dueTime - now <= leadMs && dueTime - now > 0) {
                notify('taskDeadline', 'Task due soon', t.title,
                    { dedupeKey: 'task-lead-' + t.id, onClick: () => switchApp && switchApp('kanban') });
            } else if (dueTime < now) {
                notify('taskDeadline', 'Task overdue', t.title,
                    { dedupeKey: 'task-overdue-' + t.id + '-' + todayKey(), onClick: () => switchApp && switchApp('kanban') });
            }
        });

        // Morning digest
        if (!cfg.digestEnabled) return;
        const [dh, dm] = (cfg.digestTime || '08:00').split(':').map(Number);
        const now2 = new Date();
        if (now2.getHours() === dh && now2.getMinutes() >= dm && now2.getMinutes() < dm + 5) {
            const dueToday = tasks.filter(t => new Date(t.due).toDateString() === now2.toDateString());
            const overdue = tasks.filter(t => new Date(t.due).getTime() < now);
            const cardsDue = (state.flashcards || []).filter(c => c.workspaceId === state.activeWorkspace && c.next <= now).length;
            const parts = [];
            if (dueToday.length) parts.push(`${dueToday.length} task${dueToday.length > 1 ? 's' : ''} due today`);
            if (overdue.length) parts.push(`${overdue.length} overdue`);
            if (cardsDue) parts.push(`${cardsDue} card${cardsDue > 1 ? 's' : ''} to review`);
            if (parts.length) {
                notify('taskDeadline', 'Your daily digest', parts.join(' • '),
                    { dedupeKey: 'daily-digest-' + todayKey(), ignoreQuietHours: false });
            }
        }
    }

    function checkCalendarAlerts() {
        const cfg = prefs().types.calendarAlert;
        const ws = (state.calendarBlocks || {})[state.activeWorkspace] || {};
        const today = todayKey();
        const blocks = ws[today] || [];
        const now = new Date();
        const nowMin = now.getHours() * 60 + now.getMinutes();
        (cfg.leadMinutes || [15, 60]).forEach(lead => {
            blocks.forEach(b => {
                if (!b.start) return;
                const [h, m] = b.start.split(':').map(Number);
                const blockMin = h * 60 + m;
                const diff = blockMin - nowMin;
                if (diff <= lead && diff > lead - 2) { // fires once inside a ~2min tick window
                    const label = lead >= 60 ? `${Math.round(lead / 60)}h` : `${lead}m`;
                    notify('calendarAlert', `${b.title || 'Event'} in ${label}`, `Starts at ${b.start}`,
                        { dedupeKey: 'cal-' + today + '-' + b.id + '-' + lead, onClick: () => switchApp && switchApp('calendar') });
                }
            });
        });
    }

    function checkInactiveNotes() {
        const cfg = prefs().types.inactiveNotes;
        const [dh, dm] = (cfg.digestTime || '09:00').split(':').map(Number);
        const now = new Date();
        if (!(now.getHours() === dh && now.getMinutes() >= dm && now.getMinutes() < dm + 5)) return;

        const notes = (state.notes || []).filter(n => n.workspaceId === state.activeWorkspace);
        const thresholdMs = (cfg.thresholdDays || 14) * 86400000;
        const nowTs = Date.now();
        const stale = notes.filter(n => {
            const created = parseInt(n.id, 10);
            const age = isFinite(created) ? nowTs - created : Infinity;
            if (age < thresholdMs) return false;
            const title = (n.title || '').toLowerCase();
            const isLinked = title && notes.some(other => other.id !== n.id && (other.body || '').toLowerCase().includes('[[' + title + ']]'));
            const hasOutgoingLinks = /\[\[.+?\]\]/.test(n.body || '');
            return !isLinked && !hasOutgoingLinks;
        });
        if (stale.length) {
            notify('inactiveNotes', `${stale.length} note${stale.length > 1 ? 's' : ''} going stale`,
                'These notes are unlinked and untouched for 14+ days.',
                { dedupeKey: 'stale-notes-' + todayKey(), onClick: () => switchApp && switchApp('notes') });
        }
    }

    function tick() {
        if (!state || !state.settings) return;
        const p = prefs();
        if (!p.masterEnabled) return;
        try { checkSpacedRepetition(); } catch (e) { console.warn('[Notif] srReview check failed', e); }
        try { checkFocusHabit(); } catch (e) { console.warn('[Notif] focusHabit check failed', e); }
        try { checkTaskDeadlines(); } catch (e) { console.warn('[Notif] taskDeadline check failed', e); }
        try { checkCalendarAlerts(); } catch (e) { console.warn('[Notif] calendarAlert check failed', e); }
        try { checkInactiveNotes(); } catch (e) { console.warn('[Notif] inactiveNotes check failed', e); }
    }

    let _intervalHandle = null;
    function init() {
        ensureDefaults();
        refreshPermissionCache();
        if (_intervalHandle) clearInterval(_intervalHandle);
        tick(); // run once immediately on load
        _intervalHandle = setInterval(tick, 60 * 1000); // 1-minute scheduler tick
    }

    // ================= PREFERENCES PANEL =================

    function renderPermBadge() {
        const el = document.getElementById('notif-perm-badge');
        if (!el) return;
        const s = permissionState();
        el.className = 'notif-perm-badge ' + s;
        el.textContent = s === 'granted' ? 'Enabled' : s === 'denied' ? 'Blocked' : s === 'unsupported' ? 'Unsupported' : 'Not requested';
    }

    function buildTypeRow(key) {
        const meta = TYPE_META[key];
        const cfg = prefs().types[key];
        let extra = '';
        if (key === 'taskDeadline') {
            extra = `
                <div class="flex items-center gap-2 mt-2">
                    <label class="notif-switch" title="Include in daily digest">
                        <input type="checkbox" ${cfg.digestEnabled ? 'checked' : ''} onchange="NotifSystem.setTypeField('taskDeadline','digestEnabled', this.checked)"><span class="track"></span>
                    </label>
                    <span class="text-[11px] text-textMuted">Daily digest at</span>
                    <input type="time" class="notif-time-input" value="${cfg.digestTime}" onchange="NotifSystem.setTypeField('taskDeadline','digestTime', this.value)">
                    <span class="text-[11px] text-textMuted">Lead time (hrs)</span>
                    <input type="number" min="1" max="72" class="notif-num-input" value="${cfg.leadHours}" onchange="NotifSystem.setTypeField('taskDeadline','leadHours', parseInt(this.value)||24)">
                </div>`;
        } else if (key === 'calendarAlert') {
            const lm = cfg.leadMinutes || [15, 60];
            extra = `
                <div class="flex items-center gap-3 mt-2 text-[11px] text-textMuted">
                    <label class="flex items-center gap-1"><input type="checkbox" ${lm.includes(15) ? 'checked' : ''} onchange="NotifSystem.toggleLeadMinute(15,this.checked)"> 15m before</label>
                    <label class="flex items-center gap-1"><input type="checkbox" ${lm.includes(60) ? 'checked' : ''} onchange="NotifSystem.toggleLeadMinute(60,this.checked)"> 1h before</label>
                    <label class="flex items-center gap-1"><input type="checkbox" ${lm.includes(1440) ? 'checked' : ''} onchange="NotifSystem.toggleLeadMinute(1440,this.checked)"> 1 day before</label>
                </div>`;
        } else if (key === 'inactiveNotes') {
            extra = `
                <div class="flex items-center gap-2 mt-2 text-[11px] text-textMuted">
                    <span>Flag notes untouched for</span>
                    <input type="number" min="3" max="90" class="notif-num-input" value="${cfg.thresholdDays}" onchange="NotifSystem.setTypeField('inactiveNotes','thresholdDays', parseInt(this.value)||14)">
                    <span>days • digest at</span>
                    <input type="time" class="notif-time-input" value="${cfg.digestTime}" onchange="NotifSystem.setTypeField('inactiveNotes','digestTime', this.value)">
                </div>`;
        } else if (key === 'srReview') {
            extra = `
                <div class="flex items-center gap-2 mt-2 text-[11px] text-textMuted">
                    <span>Delivery</span>
                    <select class="notif-time-input" style="width:120px" onchange="NotifSystem.setTypeField('srReview','mode', this.value)">
                        <option value="batch" ${cfg.mode === 'batch' ? 'selected' : ''}>Daily batch</option>
                        <option value="immediate" ${cfg.mode === 'immediate' ? 'selected' : ''}>As soon as due</option>
                    </select>
                </div>`;
        }
        return `
            <div class="notif-row" style="flex-direction:column;align-items:stretch;">
                <div class="flex items-center justify-between gap-3">
                    <div>
                        <div class="notif-row-label">${meta.icon} ${meta.label}</div>
                        <div class="notif-row-sub">${meta.desc}</div>
                    </div>
                    <label class="notif-switch">
                        <input type="checkbox" ${cfg.enabled ? 'checked' : ''} onchange="NotifSystem.setTypeField('${key}','enabled', this.checked)"><span class="track"></span>
                    </label>
                </div>
                ${extra}
            </div>`;
    }

    function renderPanel() {
        const host = document.getElementById('notif-prefs-body');
        if (!host) return;
        const p = prefs();
        host.innerHTML = `
            <div class="notif-row">
                <div>
                    <div class="notif-row-label">All notifications</div>
                    <div class="notif-row-sub">Master switch — turning this off silences every type below.</div>
                </div>
                <label class="notif-switch">
                    <input type="checkbox" ${p.masterEnabled ? 'checked' : ''} onchange="NotifSystem.setMaster(this.checked)"><span class="track"></span>
                </label>
            </div>
            <div class="notif-row">
                <div>
                    <div class="notif-row-label">System notifications</div>
                    <div class="notif-row-sub">Uses the native OS notification service in Graphite builds, with a browser fallback for web preview. In-app alerts are used when native delivery is unavailable.</div>
                    <div class="mt-2 flex items-center gap-2">
                        <span id="notif-perm-badge" class="notif-perm-badge default">Not requested</span>
                        <button class="text-[11px] px-2 py-1 rounded-md border border-borderDark hover:bg-black/20" onclick="NotifSystem.requestPermission()">Request permission</button>
                        <button class="text-[11px] px-2 py-1 rounded-md border border-borderDark hover:bg-black/20" onclick="NotifSystem.sendTest()">Send test</button>
                    </div>
                </div>
                <label class="notif-switch">
                    <input type="checkbox" ${p.useBrowserNotifications ? 'checked' : ''} onchange="NotifSystem.setField('useBrowserNotifications', this.checked)"><span class="track"></span>
                </label>
            </div>
            <div class="notif-row">
                <div>
                    <div class="notif-row-label">Quiet hours</div>
                    <div class="notif-row-sub">Suppress non-critical notifications during this window (digests still respect it).</div>
                    <div class="mt-2 flex items-center gap-2 text-[11px] text-textMuted">
                        <input type="time" class="notif-time-input" value="${p.quietHours.start}" onchange="NotifSystem.setQuietHours('start', this.value)">
                        <span>to</span>
                        <input type="time" class="notif-time-input" value="${p.quietHours.end}" onchange="NotifSystem.setQuietHours('end', this.value)">
                    </div>
                </div>
                <label class="notif-switch">
                    <input type="checkbox" ${p.quietHours.enabled ? 'checked' : ''} onchange="NotifSystem.setQuietHours('enabled', this.checked)"><span class="track"></span>
                </label>
            </div>
            <div class="mt-3">
                ${Object.keys(TYPE_META).map(buildTypeRow).join('')}
            </div>
        `;
        renderPermBadge();
    }

    // ---------- panel mutation helpers (exposed for inline onchange=) ----------
    function persistAndRerender() { saveDataToDB(); renderPanel(); }
    function setMaster(v) { prefs().masterEnabled = v; persistAndRerender(); }
    function setField(k, v) { prefs()[k] = v; persistAndRerender(); }
    function setTypeField(typeKey, field, v) { prefs().types[typeKey][field] = v; persistAndRerender(); }
    function setQuietHours(field, v) { prefs().quietHours[field] = v; persistAndRerender(); }
    function toggleLeadMinute(min, on) {
        const cfg = prefs().types.calendarAlert;
        const set = new Set(cfg.leadMinutes || []);
        if (on) set.add(min); else set.delete(min);
        cfg.leadMinutes = Array.from(set).sort((a, b) => a - b);
        persistAndRerender();
    }
    function sendTest() {
        notify('calendarAlert', 'Test notification', 'This is what your reminders will look like.', { dedupeKey: null, ignoreQuietHours: true });
    }

    return {
        init, tick, renderPanel, requestPermission, notify,
        setMaster, setField, setTypeField, setQuietHours, toggleLeadMinute, sendTest,
        permissionState
    };
})();

// IMPORTANT: `const NotifSystem = ...` at top level creates a lexical
// binding, NOT a property on `window` — so code elsewhere on the page
// that checks `window.NotifSystem` (or runs before this script block
// has executed) would otherwise never see it. Expose it explicitly.
window.NotifSystem = NotifSystem;

// The settings-tab script (which wires up the Notifications tab click
// handler) runs earlier in the document, before this module exists yet.
// If the user is already on that tab when this script finally loads
// (e.g. reload while tab preference was saved), render it now too.
if (document.querySelector('[data-settings-tab="notifications"]')?.classList.contains('active')) {
    NotifSystem.renderPanel();
}
