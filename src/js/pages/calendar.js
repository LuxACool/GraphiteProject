const CalendarModule = (() => {
    const SNAP_MINUTES = 15;
    const MAX_FOCUS_MINUTES_THRESHOLD = 480;

    let currentDate = new Date();
    let blocks = [];
    let loadedWorkspaceId = null;
    let liveTimerId = null;
    let initialized = false;

    const CATEGORIES = {
        deepwork: { label: 'Deep Work', isFocus: true, bgClass: 'bg-indigo-950/80', borderClass: 'border-indigo-500', textClass: 'text-indigo-200', badgeClass: 'bg-indigo-500/30 text-indigo-300' },
        meeting: { label: 'Meeting', isFocus: false, bgClass: 'bg-sky-950/80', borderClass: 'border-sky-500', textClass: 'text-sky-200', badgeClass: 'bg-sky-500/30 text-sky-300' },
        break: { label: 'Break', isFocus: false, bgClass: 'bg-emerald-950/80', borderClass: 'border-emerald-500', textClass: 'text-emerald-200', badgeClass: 'bg-emerald-500/30 text-emerald-300' },
        personal: { label: 'Personal', isFocus: false, bgClass: 'bg-amber-950/80', borderClass: 'border-amber-500', textClass: 'text-amber-200', badgeClass: 'bg-amber-500/30 text-amber-300' }
    };

    function init() {
        if (initialized) {
            refresh();
            return;
        }
        initialized = true;
        loadStorage();
        renderTimeAxis();
        renderGridLines();
        updateDateUI();
        renderBlocks();
        startLiveIndicator();
        bindGridClick();
        bindHTMLControls();
        if (isToday(currentDate)) scrollToCurrentTime();
    }

    function normalizeBlock(block, fallbackDate) {
        if (!block || typeof block !== 'object') return null;
        const date = /^\d{4}-\d{2}-\d{2}$/.test(block.date || '') ? block.date : fallbackDate;
        let startMin = Number.isFinite(block.startMin) ? block.startMin : hhmmToMin(block.start);
        let endMin = Number.isFinite(block.endMin) ? block.endMin : hhmmToMin(block.end);
        if (!Number.isFinite(startMin)) startMin = 0;
        if (!Number.isFinite(endMin) || endMin <= startMin) endMin = Math.min(1440, startMin + 60);
        startMin = Math.max(0, Math.min(1439, Math.round(startMin / SNAP_MINUTES) * SNAP_MINUTES));
        endMin = Math.max(startMin + SNAP_MINUTES, Math.min(1440, Math.round(endMin / SNAP_MINUTES) * SNAP_MINUTES));
        return {
            id: block.id || `cal_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            title: String(block.title || '').trim() || '(untitled)',
            category: CATEGORIES[block.category] ? block.category : 'deepwork',
            date,
            startMin,
            endMin,
            recurrence: ['none', 'daily', 'weekday', 'weekly'].includes(block.recurrence) ? block.recurrence : 'none',
            buffer: Number.isFinite(Number(block.buffer)) ? Math.max(0, Number(block.buffer)) : 0,
            color: block.color || undefined
        };
    }

    function readStateBlocks(workspaceId) {
        const ws = (state.calendarBlocks || {})[workspaceId] || {};
        const result = [];
        Object.entries(ws).forEach(([dateKey, value]) => {
            // Current format: { "YYYY-MM-DD": [blocks] }
            if (Array.isArray(value)) {
                value.forEach(block => {
                    const normalized = normalizeBlock(block, dateKey);
                    if (normalized) result.push(normalized);
                });
            // Legacy core format: { "HH:MM": "title" }
            } else if (/^\d{2}:\d{2}$/.test(dateKey) && typeof value === 'string') {
                const startMin = hhmmToMin(dateKey);
                result.push(normalizeBlock({
                    id: `legacy_${workspaceId}_${dateKey}`,
                    title: value,
                    startMin,
                    endMin: Math.min(1440, startMin + 60),
                    category: 'deepwork',
                    recurrence: 'none'
                }, formatDateISO(new Date())));
            }
        });
        return result;
    }

    function writeStateBlocks(workspaceId, nextBlocks) {
        if (!state.calendarBlocks) state.calendarBlocks = {};
        const ws = {};
        nextBlocks.forEach(block => {
            const dateKey = block.date || formatDateISO(currentDate);
            if (!Array.isArray(ws[dateKey])) ws[dateKey] = [];
            ws[dateKey].push({ ...block });
        });
        state.calendarBlocks[workspaceId] = ws;
    }

    function loadStorage() {
        const workspaceId = state.activeWorkspace;
        const stateBlocks = readStateBlocks(workspaceId);
        let migrated = false;

        // Migrate the old v2 calendar localStorage store exactly once when the
        // workspace-scoped IndexedDB calendar has no data yet.
        if (!stateBlocks.length) {
            try {
                const raw = localStorage.getItem('graphite_calendar_blocks');
                if (raw) {
                    const legacyBlocks = JSON.parse(raw);
                    if (Array.isArray(legacyBlocks) && legacyBlocks.length) {
                        legacyBlocks.forEach(block => {
                            const normalized = normalizeBlock(block, formatDateISO(new Date()));
                            if (normalized) stateBlocks.push(normalized);
                        });
                        migrated = stateBlocks.length > 0;
                    }
                }
            } catch (e) {
                console.warn('Calendar localStorage migration skipped:', e);
            }
        }

        // Keep an empty calendar truly empty; sample blocks are only a fallback
        // for a brand-new install with no persisted calendar data anywhere.
        blocks = stateBlocks.length ? stateBlocks : getSampleBlocks();
        loadedWorkspaceId = workspaceId;

        if (migrated || stateBlocks.length) {
            writeStateBlocks(workspaceId, blocks);
            saveDataToDB();
            try { localStorage.removeItem('graphite_calendar_blocks'); } catch (e) {}
        }
    }

    function saveStorage() {
        const workspaceId = state.activeWorkspace;
        if (!workspaceId) return;
        writeStateBlocks(workspaceId, blocks);
        loadedWorkspaceId = workspaceId;
        saveDataToDB();
    }

    function refresh() {
        const workspaceId = state.activeWorkspace;
        if (!workspaceId) return;
        if (workspaceId !== loadedWorkspaceId) {
            loadStorage();
            updateDateUI();
        }
        renderBlocks();
        updateLiveIndicator();
    }

    function getSampleBlocks() {
        const todayStr = formatDateISO(new Date());
        return [
            { id: 'b1', title: 'Deep Work: Core Engine', category: 'deepwork', date: todayStr, startMin: 540, endMin: 660, recurrence: 'none', buffer: 10 },
            { id: 'b1-buf', title: 'Break', category: 'break', date: todayStr, startMin: 660, endMin: 670, recurrence: 'none', buffer: 0 },
            { id: 'b2', title: 'Sync with Engineering', category: 'meeting', date: todayStr, startMin: 690, endMin: 750, recurrence: 'daily', buffer: 0 }
        ];
    }

    function formatDateISO(d) {
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    function minToHHMM(mins) {
        return `${String(Math.floor(mins / 60) % 24).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
    }

    function hhmmToMin(str) {
        if (!str) return 0;
        const [h, m] = str.split(':').map(Number);
        return (h * 60) + (m || 0);
    }

    function isToday(d) {
        const now = new Date();
        return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    }

    function renderTimeAxis() {
        const container = document.getElementById('cal-time-axis');
        if (!container) return;
        container.innerHTML = '';
        for (let h = 0; h < 24; h++) {
            const div = document.createElement('div');
            div.className = 'h-[60px] relative text-[11px] font-mono text-textMuted/70 text-right pr-2 pt-1 select-none border-b border-transparent';
            div.innerHTML = `<span>${String(h).padStart(2, '0')}:00</span>`;
            container.appendChild(div);
        }
    }

    function renderGridLines() {
        const container = document.getElementById('cal-grid-lines');
        if (!container) return;
        container.innerHTML = '';
        for (let h = 0; h < 24; h++) {
            const hourRow = document.createElement('div');
            hourRow.className = 'h-[60px] border-b border-borderDark/30 relative box-border';
            const halfLine = document.createElement('div');
            halfLine.className = 'absolute top-[30px] left-0 right-0 border-b border-dashed border-borderDark/15';
            hourRow.appendChild(halfLine);
            container.appendChild(hourRow);
        }
    }

    function updateDateUI() {
        const dateInput = document.getElementById('cal-date-input');
        const dateLabel = document.getElementById('cal-date-label');
        if (dateInput) dateInput.value = formatDateISO(currentDate);
        if (dateLabel) dateLabel.textContent = currentDate.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
    }

    function getActiveDateBlocks() {
        const targetStr = formatDateISO(currentDate);
        const dayOfWeek = currentDate.getDay();
        const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;

        return blocks.filter(b => {
            if (b.date === targetStr) return true;
            if (!b.recurrence || b.recurrence === 'none') return false;
            const originDate = new Date(b.date + 'T00:00:00');
            if (originDate > currentDate) return false;
            if (b.recurrence === 'daily') return true;
            if (b.recurrence === 'weekday' && isWeekday) return true;
            if (b.recurrence === 'weekly' && originDate.getDay() === dayOfWeek) return true;
            return false;
        });
    }

    function computeOverlappingLayout(activeBlocks) {
        const sorted = [...activeBlocks].sort((a, b) => a.startMin - b.startMin || (b.endMin - b.startMin) - (a.endMin - a.startMin));
        const clusters = [];
        let currentCluster = [];
        let clusterEnd = -1;

        sorted.forEach(block => {
            if (!currentCluster.length) {
                currentCluster.push(block);
                clusterEnd = block.endMin;
            } else {
                if (block.startMin < clusterEnd) {
                    currentCluster.push(block);
                    clusterEnd = Math.max(clusterEnd, block.endMin);
                } else {
                    clusters.push(currentCluster);
                    currentCluster = [block];
                    clusterEnd = block.endMin;
                }
            }
        });
        if (currentCluster.length) clusters.push(currentCluster);

        const layoutMap = new Map();
        clusters.forEach(cluster => {
            const columns = [];
            cluster.forEach(block => {
                let placed = false;
                for (let c = 0; c < columns.length; c++) {
                    const hasOverlap = columns[c].some(b => !(block.startMin >= b.endMin || block.endMin <= b.startMin));
                    if (!hasOverlap) {
                        columns[c].push(block);
                        layoutMap.set(block.id, { colIndex: c, totalCols: 0 });
                        placed = true;
                        break;
                    }
                }
                if (!placed) {
                    const colIdx = columns.length;
                    columns.push([block]);
                    layoutMap.set(block.id, { colIndex: colIdx, totalCols: 0 });
                }
            });
            cluster.forEach(block => {
                const info = layoutMap.get(block.id);
                if (info) info.totalCols = columns.length;
            });
        });

        return layoutMap;
    }

    function renderBlocks() {
        if (state.activeWorkspace !== loadedWorkspaceId) loadStorage();
        const container = document.getElementById('cal-blocks-layer');
        if (!container) return;
        container.innerHTML = '';

        const activeBlocks = getActiveDateBlocks();
        const layoutMap = computeOverlappingLayout(activeBlocks);

        let totalFocusMins = 0;
        let hasConflict = false;

        for (let i = 0; i < activeBlocks.length; i++) {
            const cat = CATEGORIES[activeBlocks[i].category] || CATEGORIES.deepwork;
            if (cat.isFocus) totalFocusMins += (activeBlocks[i].endMin - activeBlocks[i].startMin);
            for (let j = i + 1; j < activeBlocks.length; j++) {
                if (activeBlocks[i].startMin < activeBlocks[j].endMin && activeBlocks[i].endMin > activeBlocks[j].startMin) {
                    hasConflict = true;
                }
            }
        }

        activeBlocks.forEach(block => {
            const layout = layoutMap.get(block.id) || { colIndex: 0, totalCols: 1 };
            const cat = CATEGORIES[block.category] || CATEGORIES.deepwork;

            const top = block.startMin;
            const height = Math.max(20, block.endMin - block.startMin);
            const widthPct = 100 / layout.totalCols;
            const leftPct = layout.colIndex * widthPct;

            const el = document.createElement('div');
            el.className = `absolute rounded-xl border p-2 flex flex-col justify-between transition-shadow shadow-md cursor-grab active:cursor-grabbing ${cat.bgClass} ${cat.borderClass} ${cat.textClass}`;
            el.style.top = `${top}px`;
            el.style.height = `${height}px`;
            el.style.left = `calc(${leftPct}% + 2px)`;
            el.style.width = `calc(${widthPct}% - 4px)`;
            el.style.touchAction = 'none';

            el.innerHTML = `
                <div class="pointer-events-none overflow-hidden">
                    <div class="flex items-center justify-between gap-1 mb-0.5">
                        <span class="font-bold text-xs truncate">${escapeHTML(block.title)}</span>
                        <span class="text-[9px] px-1.5 py-0.5 rounded-full font-semibold uppercase ${cat.badgeClass}">${cat.label}</span>
                    </div>
                    <div class="text-[10px] font-mono opacity-80">${minToHHMM(block.startMin)} - ${minToHHMM(block.endMin)}</div>
                </div>
                <div class="cal-resize-handle absolute bottom-0 left-0 right-0 h-3 cursor-ns-resize flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                    <div class="w-8 h-1 rounded-full bg-white/40 pointer-events-none"></div>
                </div>
            `;

            attachPointerEvents(el, block);
            container.appendChild(el);
        });

        const overloadBadge = document.getElementById('cal-overload-badge');
        const conflictBadge = document.getElementById('cal-conflict-badge');
        const summaryStats = document.getElementById('cal-summary-stats');

        if (overloadBadge) overloadBadge.classList.toggle('hidden', totalFocusMins <= MAX_FOCUS_MINUTES_THRESHOLD);
        if (conflictBadge) conflictBadge.classList.toggle('hidden', !hasConflict);
        if (summaryStats) summaryStats.textContent = `Focus: ${Math.floor(totalFocusMins / 60)}h ${totalFocusMins % 60}m / 8h max`;
    }

    function attachPointerEvents(element, block) {
        element.addEventListener('pointerdown', (e) => {
            const isResize = e.target.classList.contains('cal-resize-handle');
            const startY = e.clientY;
            const initialStart = block.startMin;
            const initialEnd = block.endMin;
            const initialDuration = initialEnd - initialStart;
            let hasMoved = false;

            element.setPointerCapture(e.pointerId);

            function onPointerMove(moveEv) {
                const deltaY = moveEv.clientY - startY;
                if (Math.abs(deltaY) > 4) hasMoved = true;

                if (!hasMoved) return;

                if (isResize) {
                    const deltaMins = Math.round(deltaY / SNAP_MINUTES) * SNAP_MINUTES;
                    block.endMin = Math.max(initialStart + SNAP_MINUTES, Math.min(1440, initialEnd + deltaMins));
                } else {
                    const deltaMins = Math.round(deltaY / SNAP_MINUTES) * SNAP_MINUTES;
                    let newStart = Math.max(0, Math.min(1440 - initialDuration, initialStart + deltaMins));
                    block.startMin = newStart;
                    block.endMin = newStart + initialDuration;
                }

                renderBlocks();
            }

            function onPointerUp(upEv) {
                try { element.releasePointerCapture(upEv.pointerId); } catch(err) {}
                element.removeEventListener('pointermove', onPointerMove);
                element.removeEventListener('pointerup', onPointerUp);
                element.removeEventListener('pointercancel', onPointerUp);

                if (!hasMoved) {
                    openModal(block);
                } else {
                    saveStorage();
                }
            }

            element.addEventListener('pointermove', onPointerMove);
            element.addEventListener('pointerup', onPointerUp);
            element.addEventListener('pointercancel', onPointerUp);
        });
    }

    function bindGridClick() {
        const grid = document.getElementById('calendar-grid');
        if (!grid) return;

        grid.addEventListener('click', (e) => {
            if (e.target.closest('#cal-blocks-layer > div')) return;

            const rect = grid.getBoundingClientRect();
            const clickY = e.clientY - rect.top;
            const startMin = Math.floor(Math.floor(clickY) / SNAP_MINUTES) * SNAP_MINUTES;

            openModal({
                id: '',
                title: '',
                category: 'deepwork',
                date: formatDateISO(currentDate),
                startMin: startMin,
                endMin: Math.min(1440, startMin + 60),
                recurrence: 'none',
                buffer: 0
            });
        });
    }

    function startLiveIndicator() {
        updateLiveIndicator();
        if (liveTimerId) clearInterval(liveTimerId);
        liveTimerId = setInterval(updateLiveIndicator, 60000);
    }

    function updateLiveIndicator() {
        const line = document.getElementById('cal-live-indicator');
        const label = document.getElementById('cal-live-time-label');
        if (!line) return;

        if (!isToday(currentDate)) {
            line.classList.add('hidden');
            return;
        }

        const now = new Date();
        const mins = (now.getHours() * 60) + now.getMinutes();

        line.classList.remove('hidden');
        line.style.top = `${mins}px`;
        if (label) label.textContent = minToHHMM(mins);
    }

    function scrollToCurrentTime() {
        const scrollContainer = document.getElementById('cal-grid-scroll-container');
        if (!scrollContainer) return;
        const now = new Date();
        scrollContainer.scrollTop = Math.max(0, ((now.getHours() * 60) + now.getMinutes()) - 200);
    }

    function openModal(block = null) {
        const modal = document.getElementById('cal-modal');
        const titleEl = document.getElementById('cal-modal-title');
        const idInput = document.getElementById('cal-block-id');
        const titleInput = document.getElementById('cal-input-title');
        const catSelect = document.getElementById('cal-input-category');
        const recSelect = document.getElementById('cal-input-recurrence');
        const startInput = document.getElementById('cal-input-start');
        const endInput = document.getElementById('cal-input-end');
        const bufferSelect = document.getElementById('cal-input-buffer');
        const btnDelete = document.getElementById('cal-btn-delete');

        if (!modal) return;

        if (block && block.id) {
            titleEl.textContent = 'Edit Time Block';
            idInput.value = block.id;
            titleInput.value = block.title || '';
            catSelect.value = block.category || 'deepwork';
            recSelect.value = block.recurrence || 'none';
            startInput.value = minToHHMM(block.startMin);
            endInput.value = minToHHMM(block.endMin);
            bufferSelect.value = block.buffer || 0;
            btnDelete.classList.remove('hidden');
        } else {
            titleEl.textContent = 'New Time Block';
            idInput.value = '';
            titleInput.value = '';
            catSelect.value = 'deepwork';
            recSelect.value = 'none';
            startInput.value = minToHHMM(block ? block.startMin : 540);
            endInput.value = minToHHMM(block ? block.endMin : 600);
            bufferSelect.value = '0';
            btnDelete.classList.add('hidden');
        }

        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }

    function closeModal() {
        const modal = document.getElementById('cal-modal');
        if (modal) {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
        }
    }

    function saveBlock(e) {
        e.preventDefault();
        const idInput = document.getElementById('cal-block-id').value;
        const titleInput = document.getElementById('cal-input-title').value.trim();
        const catSelect = document.getElementById('cal-input-category').value;
        const recSelect = document.getElementById('cal-input-recurrence').value;
        const startMin = hhmmToMin(document.getElementById('cal-input-start').value);
        const endMin = hhmmToMin(document.getElementById('cal-input-end').value);
        const bufferMins = Number(document.getElementById('cal-input-buffer').value);

        if (endMin <= startMin) {
            toast('End time must be after start time.', 'error');
            return;
        }

        const dateStr = formatDateISO(currentDate);

        if (idInput) {
            const idx = blocks.findIndex(b => b.id === idInput);
            if (idx !== -1) {
                blocks[idx] = { ...blocks[idx], title: titleInput, category: catSelect, recurrence: recSelect, startMin, endMin, buffer: bufferMins };
            }
        } else {
            blocks.push({
                id: 'b_' + Date.now(),
                title: titleInput,
                category: catSelect,
                date: dateStr,
                startMin,
                endMin,
                recurrence: recSelect,
                buffer: bufferMins
            });

            if (bufferMins > 0 && catSelect === 'deepwork') {
                blocks.push({
                    id: 'b_buf_' + Date.now(),
                    title: 'Break (Buffer)',
                    category: 'break',
                    date: dateStr,
                    startMin: endMin,
                    endMin: Math.min(1440, endMin + bufferMins),
                    recurrence: recSelect,
                    buffer: 0
                });
            }
        }

        saveStorage();
        closeModal();
        renderBlocks();
    }

    function deleteBlock() {
        const idInput = document.getElementById('cal-block-id').value;
        if (!idInput) return;
        blocks = blocks.filter(b => b.id !== idInput);
        saveStorage();
        closeModal();
        renderBlocks();
    }

    function goToToday() {
        currentDate = new Date();
        updateDateUI();
        renderBlocks();
        updateLiveIndicator();
        scrollToCurrentTime();
    }

    function setDate(dateStr) {
        if (!dateStr) return;
        const parts = dateStr.split('-');
        if (parts.length === 3) {
            currentDate = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
            updateDateUI();
            renderBlocks();
            updateLiveIndicator();
        }
    }

    function shiftDate(days) {
        if (!(currentDate instanceof Date) || isNaN(currentDate.getTime())) {
            currentDate = new Date();
        }
        const newDate = new Date(currentDate);
        newDate.setDate(newDate.getDate() + days);
        currentDate = newDate;

        updateDateUI();
        renderBlocks();
        updateLiveIndicator();
    }

   function escapeHTML(str) {
        return String(str ?? '').replace(/[&<>'"]/g, tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag));
    }

    function bindHTMLControls() {
        // Toolbar mapping
        document.getElementById('cal-prev-btn')?.addEventListener('click', () => shiftDate(-1));
        document.getElementById('cal-next-btn')?.addEventListener('click', () => shiftDate(1));
        document.getElementById('cal-today-btn')?.addEventListener('click', () => goToToday());
        document.getElementById('cal-date-input')?.addEventListener('change', (e) => setDate(e.target.value));
        document.getElementById('cal-new-block-btn')?.addEventListener('click', () => openModal());

        // Form mapping
        document.getElementById('cal-form')?.addEventListener('submit', (e) => saveBlock(e));
        document.getElementById('cal-btn-delete')?.addEventListener('click', () => deleteBlock());

        // Modal closing mapping
        const closeButtons = ['cal-modal-close-1', 'cal-modal-close-2'];
        closeButtons.forEach(id => {
            document.getElementById(id)?.addEventListener('click', () => closeModal());
        });
    }

    return {
        init,
        refresh,
        shiftDate,
        goToToday,
        setDate,
        openModal,
        closeModal,
        saveBlock,
        deleteBlock
    };
})();
window.CalendarModule = CalendarModule;

// Global wrapper functions remain valid for inline HTML onclick attributes (if any still exist)
function shiftCalendarDate(days) { CalendarModule.shiftDate(days); }
function goCalendarToday() { CalendarModule.goToToday(); }
function setCalendarDate(dateStr) { CalendarModule.setDate(dateStr); }
function openCalendarModal(block) { CalendarModule.openModal(block); }
function closeCalendarModal() { CalendarModule.closeModal(); }
function saveCalendarBlock(e) { CalendarModule.saveBlock(e); }
function deleteCalendarBlock() { CalendarModule.deleteBlock(); }
function newCalendarBlock() { CalendarModule.openModal(); }

function startCalendarModule() {
    const ready = window.graphiteReady;
    if (ready && typeof ready.then === 'function') {
        ready.then(() => CalendarModule.init()).catch(err => console.error('Calendar initialization failed:', err));
    } else {
        CalendarModule.init();
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startCalendarModule, { once: true });
} else {
    startCalendarModule();
}
