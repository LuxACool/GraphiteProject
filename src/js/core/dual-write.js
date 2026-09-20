/* IndexedDB -> SQLite dual-write bridge.
 *
 * IndexedDB remains the live source of truth during this phase. Every successful
 * IndexedDB save schedules a debounced SQLite snapshot. SQLite failures are
 * observable but never block the existing UI save path.
 */
(function () {
  const Graphite = window.Graphite = window.Graphite || {};
  const DEBOUNCE_MS = 700;
  let timer = null;
  let pendingState = null;
  let inFlight = null;
  let lastReport = null;
  let authoritative = false;

  function available() {
    return Boolean(Graphite.repositories?.isAvailable?.());
  }

  function toTimestamp(value, endOfDay = false) {
    if (value == null || value === '') return null;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const raw = String(value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      const d = new Date(`${raw}T${endOfDay ? '23:59:59.999' : '00:00:00'}`);
      return Number.isNaN(d.getTime()) ? null : d.getTime();
    }
    const n = Date.parse(raw);
    return Number.isNaN(n) ? null : n;
  }

  function calendarEvents(state) {
    const events = [];
    Object.entries(state.calendarBlocks || {}).forEach(([workspaceId, days]) => {
      Object.entries(days || {}).forEach(([date, blocks]) => {
        if (!Array.isArray(blocks)) return;
        blocks.forEach(block => {
          const startMin = Number.isFinite(Number(block.startMin)) ? Number(block.startMin) : 0;
          const endMin = Number.isFinite(Number(block.endMin)) ? Number(block.endMin) : Math.min(1440, startMin + 60);
          const start = toTimestamp(date);
          if (start == null) return;
          const metadata = {
            category: block.category || 'deepwork',
            buffer: Number(block.buffer) || 0,
            source: 'indexeddb-calendar'
          };
          events.push({
            id: String(block.id || `cal_${workspaceId}_${date}_${startMin}`),
            workspaceId,
            title: String(block.title || '(untitled)'),
            description: '',
            startAt: start + startMin * 60000,
            endAt: start + endMin * 60000,
            allDay: false,
            color: block.color || null,
            recurrence: block.recurrence || 'none',
            metadataJson: JSON.stringify(metadata)
          });
        });
      });
    });
    return events;
  }

  function sessionRows(state) {
    return (state.sessionLog || []).map(s => {
      const started = toTimestamp(s.date || new Date().toISOString().slice(0, 10));
      const duration = Math.max(0, Number(s.duration) || 0) * 60;
      return {
        id: String(s.id),
        workspaceId: s.workspaceId || state.activeWorkspace,
        subject: s.subject || null,
        startedAt: started || Date.now(),
        endedAt: started ? started + duration * 1000 : null,
        durationSeconds: duration,
        sessionType: 'focus',
        completed: true,
        metadataJson: JSON.stringify({ noteId: s.noteId || null, noteTitle: s.noteTitle || null, pomodoros: s.pomodoros || 1 })
      };
    });
  }

  function remainingPayload(state) {
    return {
      canvasStrokes: Array.isArray(state.canvasStrokes) ? state.canvasStrokes : [],
      mindmaps: Array.isArray(state.mindmaps) ? state.mindmaps : [],
      journal: state.journal && typeof state.journal === 'object' ? state.journal : {},
      habits: Array.isArray(state.habits) ? state.habits : [],
      reading: Array.isArray(state.reading) ? state.reading : [],
      tutorChat: Array.isArray(state.tutorChat) ? state.tutorChat : [],
      examCountdowns: Array.isArray(state.examCountdowns) ? state.examCountdowns : [],
      xp: Number(state.xp) || 0,
      badges: Array.isArray(state.badges) ? state.badges : [],
      settings: state.settings && typeof state.settings === 'object' ? state.settings : {},
      activityHistory: state.activityHistory && typeof state.activityHistory === 'object' ? state.activityHistory : {},
      kssHistory: Array.isArray(state.kssHistory) ? state.kssHistory : []
    };
  }

  function payload(state) {
    return {
      workspaces: (state.workspaces || []).map(w => ({
        id: String(w.id), name: String(w.name || 'Workspace'), color: w.color || null,
        lastApp: w.lastApp || null, focusMinutes: Number(w.focusMinutes) || 0
      })),
      notes: (state.notes || []).map(n => ({
        id: String(n.id), workspaceId: n.workspaceId || state.activeWorkspace,
        title: String(n.title || ''), body: String(n.body || ''), tags: String(n.tags || ''),
        metadataJson: JSON.stringify({ timestamp: n.timestamp || null })
      })),
      tasks: ['todo', 'progress', 'done'].flatMap(column => (state.kanban?.[column] || []).map((t, index) => ({
        id: String(t.id), workspaceId: t.workspaceId || state.activeWorkspace, columnId: column,
        title: String(t.title || ''), description: t.description || '', priority: t.priority || 'Normal',
        dueAt: toTimestamp(t.due), position: Number.isFinite(Number(t.position)) ? Number(t.position) : index,
        metadataJson: JSON.stringify({ due: t.due || null })
      }))),
      calendarEvents: calendarEvents(state),
      flashcards: (state.flashcards || []).map(c => ({
        id: String(c.id), workspaceId: c.workspaceId || state.activeWorkspace,
        question: String(c.q || ''), answer: String(c.a || ''), repetitions: Number(c.rep) || 0,
        intervalDays: Number(c.int) || 1, easeFactor: Number(c.ef) || 2.5, nextReviewAt: toTimestamp(c.next),
        metadataJson: JSON.stringify({ type: c.type || 'basic', options: c.options || [] })
      })),
      sessions: sessionRows(state)
    };
  }

  async function readAuthoritative() {
    if (!available()) throw new Error('SQLite is unavailable.');
    const [core, remaining] = await Promise.all([
      Graphite.native.invoke('repository_snapshot'),
      Graphite.native.invoke('repository_remaining_snapshot', {})
    ]);
    return { ...core, remaining };
  }

  function fromPayload(p, previousState) {
    if (!p || typeof p !== 'object') throw new Error('SQLite returned an invalid authoritative snapshot.');
    const next = { ...previousState };
    next.workspaces = (p.workspaces || []).map(w => ({
      id: String(w.id), name: String(w.name || 'Workspace'), color: w.color || '#8b5cf6',
      lastApp: w.lastApp || 'dashboard', focusMinutes: Number(w.focusMinutes) || 0
    }));
    if (!next.workspaces.length) throw new Error('SQLite contains no workspaces.');
    next.notes = (p.notes || []).map(n => {
      let meta = {}; try { meta = JSON.parse(n.metadataJson || '{}') || {}; } catch (_) {}
      return { id: String(n.id), workspaceId: String(n.workspaceId), title: String(n.title || ''), body: String(n.body || ''), tags: String(n.tags || ''), timestamp: meta.timestamp || new Date(n.updatedAt || Date.now()).toLocaleDateString() };
    });
    next.kanban = { todo: [], progress: [], done: [] };
    (p.tasks || []).forEach(t => {
      let meta = {}; try { meta = JSON.parse(t.metadataJson || '{}') || {}; } catch (_) {}
      const column = ['todo','progress','done'].includes(t.columnId) ? t.columnId : 'todo';
      next.kanban[column].push({ id: String(t.id), workspaceId: String(t.workspaceId), title: String(t.title || ''), description: t.description || '', priority: t.priority || 'Normal', due: meta.due || (t.dueAt ? new Date(t.dueAt).toISOString().slice(0,10) : ''), position: Number(t.position) || 0 });
    });
    next.flashcards = (p.flashcards || []).map(c => {
      let meta = {}; try { meta = JSON.parse(c.metadataJson || '{}') || {}; } catch (_) {}
      return { id: String(c.id), workspaceId: String(c.workspaceId), q: String(c.question || ''), a: String(c.answer || ''), rep: Number(c.repetitions) || 0, int: Number(c.intervalDays) || 1, ef: Number(c.easeFactor) || 2.5, next: c.nextReviewAt || Date.now(), type: meta.type || 'basic', options: Array.isArray(meta.options) ? meta.options : [] };
    });
    next.sessionLog = (p.sessions || []).map(s => ({
      id: String(s.id), workspaceId: String(s.workspaceId), date: new Date(s.startedAt).toLocaleDateString('en-CA'), subject: s.subject || '', duration: Math.max(0, Math.round(Number(s.durationSeconds || 0) / 60)), noteId: null, noteTitle: null, pomodoros: 1
    }));
    next.calendarBlocks = {};
    (p.calendarEvents || []).forEach(e => {
      const start = new Date(e.startAt), end = new Date(e.endAt);
      const date = `${start.getFullYear()}-${String(start.getMonth()+1).padStart(2,'0')}-${String(start.getDate()).padStart(2,'0')}`;
      const startMin = start.getHours()*60 + start.getMinutes();
      const endMin = Math.max(startMin + 15, end.getHours()*60 + end.getMinutes());
      let meta = {}; try { meta = JSON.parse(e.metadataJson || '{}') || {}; } catch (_) {}
      const block = { id: String(e.id), title: String(e.title || '(untitled)'), category: meta.category || 'deepwork', date, startMin, endMin: Math.min(1440,endMin), recurrence: e.recurrence || 'none', buffer: Number(meta.buffer) || 0 };
      if (e.color) block.color = e.color;
      if (!next.calendarBlocks[e.workspaceId]) next.calendarBlocks[e.workspaceId] = {};
      if (!Array.isArray(next.calendarBlocks[e.workspaceId][date])) next.calendarBlocks[e.workspaceId][date] = [];
      next.calendarBlocks[e.workspaceId][date].push(block);
    });
    if (p.remaining && typeof p.remaining === 'object') {
      const r = p.remaining;
      next.canvasStrokes = Array.isArray(r.canvasStrokes) ? r.canvasStrokes : [];
      next.mindmaps = Array.isArray(r.mindmaps) ? r.mindmaps : [];
      next.journal = r.journal && typeof r.journal === 'object' ? r.journal : {};
      next.habits = Array.isArray(r.habits) ? r.habits : [];
      next.reading = Array.isArray(r.reading) ? r.reading : [];
      next.tutorChat = Array.isArray(r.tutorChat) ? r.tutorChat : [];
      next.examCountdowns = Array.isArray(r.examCountdowns) ? r.examCountdowns : [];
      next.xp = Number(r.xp) || 0;
      next.badges = Array.isArray(r.badges) ? r.badges : [];
      next.settings = r.settings && typeof r.settings === 'object' ? { ...next.settings, ...r.settings } : next.settings;
      next.activityHistory = r.activityHistory && typeof r.activityHistory === 'object' ? r.activityHistory : {};
      next.kssHistory = Array.isArray(r.kssHistory) ? r.kssHistory : [];
    }
    next.activeWorkspace = next.workspaces.some(w => w.id === next.activeWorkspace) ? next.activeWorkspace : next.workspaces[0].id;
    return next;
  }

  async function syncNow(snapshot) {
    if (!available()) return null;
    const p = payload(snapshot);
    const report = await Graphite.native.invoke('repository_dual_write_state', { payload: p });
    await Graphite.native.invoke('repository_remaining_upsert', { state: remainingPayload(snapshot) });
    const actual = await Graphite.native.invoke('repository_dual_write_counts');
    const verified = Object.keys(report).every(k => Number(report[k]) === Number(actual[k])) &&
      actual.workspaces === p.workspaces.length &&
      actual.notes === p.notes.length &&
      actual.tasks === p.tasks.length &&
      actual.calendarEvents === p.calendarEvents.length &&
      actual.flashcards === p.flashcards.length &&
      actual.sessions === p.sessions.length;
    lastReport = { report, actual, verified, at: Date.now() };
    Graphite.events?.emit('dualwrite:verified', lastReport);
    if (!verified) console.warn('Graphite SQLite dual-write verification mismatch:', lastReport);
    return lastReport;
  }

  function queue(snapshot) {
    if (authoritative || !available()) return;
    pendingState = snapshot;
    clearTimeout(timer);
    timer = setTimeout(flush, DEBOUNCE_MS);
  }

  async function flush() {
    clearTimeout(timer); timer = null;
    if (!pendingState || !available()) return lastReport;
    const snapshot = pendingState;
    pendingState = null;
    inFlight = syncNow(snapshot).catch(error => {
      console.error('Graphite SQLite dual-write failed; IndexedDB remains authoritative:', error);
      Graphite.events?.emit('dualwrite:error', { error });
      return null;
    }).finally(() => { inFlight = null; });
    return inFlight;
  }

  Graphite.dualWrite = { available, queue, flush, syncNow, readAuthoritative, fromPayload, payload, remainingPayload, setAuthoritative: value => { authoritative = Boolean(value); }, isAuthoritative: () => authoritative, status: () => ({ sourceOfTruth: authoritative ? 'sqlite' : 'indexeddb', nativeAvailable: available() }), getLastReport: () => lastReport };
})();
