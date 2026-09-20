/* =========================================
   CORE UI & NAVIGATION
   ========================================= */
let currentApp = 'dashboard';

function bootOS() {
    const _goalInput = document.getElementById('daily-goal-input');
    if (_goalInput) _goalInput.value = state.goal || "";
    const _goalDisplay = document.getElementById('active-goal-display');
    if (_goalDisplay) _goalDisplay.innerText = state.goal || "No Goal Set";
    renderPomoDots(); initReadingProgress();

    renderNotesList();
    const currentNote = state.notes.find(n => n.id === state.currentNoteId);
    if(currentNote && currentNote.workspaceId === state.activeWorkspace) { loadNoteIntoEditor(state.currentNoteId); } 
    else { document.getElementById('editor-empty').classList.remove('hidden'); document.getElementById('editor-active').classList.add('hidden'); }

    try { renderKanban(); } catch (e) { console.error('renderKanban failed', e); }
    try { updateFlashcardUI(); } catch (e) { console.error('updateFlashcardUI failed', e); }
    initCanvas();
    if (window._eraserMouseSetup) window._eraserMouseSetup();

    const ws = state.workspaces.find(w => w.id === state.activeWorkspace);
    GraphiteRouter.initialize(ws?.lastApp || 'dashboard'); 
}

/* ---------------------------------------------------------------------------
 * Centralized persistent page router
 *
 * Pages are mounted once by bootstrap.js. Navigation only changes which
 * already-mounted page is active; it never rebuilds page DOM or creates an
 * empty viewport between routes.
 * ------------------------------------------------------------------------- */
const GraphiteRouter = window.GraphiteRouter || (() => {
    const labels = {
        dashboard: 'Dashboard',
        pomodoro: 'Focus',
        calendar: 'Calendar',
        notes: 'Notes',
        graph: 'Graph',
        flashcards: 'Spaced Repetition',
        kanban: 'Tasks',
        canvas: 'Whiteboard',
        settings: 'Settings',
        cognitive: 'Cognitive Lab',
        sessions: 'Session Log',
        search: 'Search',
        tutor: 'AI Tutor',
        soundscape: 'Soundscape'
    };

    let activeRoute = null;
    let persistQueued = false;

    const getPage = (appId) => document.getElementById(`app-${appId}`);
    const getPages = () => Array.from(document.querySelectorAll('#app-views > .app-module'));

    function queueLastAppPersistence() {
        if (persistQueued) return;
        persistQueued = true;

        const flush = () => {
            persistQueued = false;
            try { saveDataToDB(); } catch (error) {
                console.error('Failed to persist last app:', error);
            }
        };

        if (typeof requestIdleCallback === 'function') {
            requestIdleCallback(flush, { timeout: 750 });
        } else {
            queueMicrotask(flush);
        }
    }

    function closeMobileChrome(appId) {
        if (window.innerWidth >= 768) return;
        document.getElementById('main-sidebar')?.classList.add('-translate-x-full');
        document.getElementById('mobile-overlay')?.classList.add('hidden');

        const mobTitle = document.getElementById('mobile-header-title');
        if (mobTitle) mobTitle.textContent = labels[appId] || 'Graphite';

        if (appId !== 'notes' && typeof closeMobileNotesList === 'function') {
            closeMobileNotesList();
        }
    }

    function updateNavigationChrome(appId) {
        document.querySelectorAll('.nav-item').forEach((el) => {
            const active = el.id === `nav-${appId}`;
            el.classList.toggle('active-nav', active);
            el.setAttribute('aria-current', active ? 'page' : 'false');
        });

        const breadcrumb = document.getElementById('breadcrumb-current');
        if (breadcrumb) breadcrumb.innerText = labels[appId] || 'Workspace';
    }

    function activatePage(target, appId, previousApp) {
        // The destination is activated FIRST. Because the page viewport is a
        // persistent stack, there is always a rendered page covering the view.
        target.classList.remove('hidden');
        target.classList.add('route-active');
        target.setAttribute('aria-hidden', 'false');
        target.dataset.routeActive = 'true';
        // Trigger a lightweight paint-only entrance without animating the
        // entire page compositor layer. Direct children are enough to give
        // every screen a consistent transition while keeping navigation cheap.
        if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
            requestAnimationFrame(() => {
                Array.from(target.children).forEach((child) => {
                    child.classList.remove('graphite-route-item-enter');
                    void child.offsetWidth;
                    child.classList.add('graphite-route-item-enter');
                    child.addEventListener('animationend', () => child.classList.remove('graphite-route-item-enter'), { once: true });
                });
            });
        }

        if (previousApp && previousApp !== appId) {
            const previous = getPage(previousApp);
            if (previous && previous !== target) {
                previous.classList.remove('route-active');
                previous.setAttribute('aria-hidden', 'true');
                previous.dataset.routeActive = 'false';
            }
        }

        // Safety: normalize any pages that were not managed by the router.
        getPages().forEach((page) => {
            if (page === target) return;
            if (page.dataset.routeActive === 'true') {
                page.classList.remove('route-active');
                page.setAttribute('aria-hidden', 'true');
                page.dataset.routeActive = 'false';
            }
        });
    }

    function renderActivatedPage(appId) {
        // These are refresh/activation hooks, not DOM mounting. They can run
        // repeatedly while the page itself remains mounted.
        if (appId === 'dashboard') {
            updateDashboard();
            updateSynthesisCard();
            renderExamCountdowns();
            renderSessionDashWidget();
        }
        if (appId === 'canvas') {
            requestAnimationFrame(() => {
                resizeCanvas();
                redrawCanvas();
            });
        }
        if (appId === 'graph') renderKnowledgeGraph();
        if (appId === 'cognitive') runKSSAnalysis();
        if (appId === 'sessions') renderSessionLog();
        if (appId === 'search') {
            requestAnimationFrame(() => document.getElementById('fts-input')?.focus());
        }
        if (appId === 'pomodoro') renderPomoRecentSessions();
        if (appId === 'flashcards') updateFlashcardUI();
    }

    function navigate(appId) {
        const target = getPage(appId);
        if (!target) {
            console.warn(`[NAV] Unknown route: ${appId}`);
            return false;
        }

        const previousApp = activeRoute || currentApp || null;
        if (previousApp === appId && target.dataset.routeActive === 'true') {
            return false;
        }

        if (previousApp === 'canvas' && appId !== 'canvas' &&
            document.pointerLockElement === window.canvas) {
            document.exitPointerLock();
        }

        Graphite.events?.emit('navigation:before-change', {
            from: previousApp,
            to: appId
        });

        const ws = state.workspaces.find(w => w.id === state.activeWorkspace);
        if (ws) ws.lastApp = appId;

        closeMobileChrome(appId);
        activatePage(target, appId, previousApp);
        updateNavigationChrome(appId);

        currentApp = appId;
        activeRoute = appId;

        renderActivatedPage(appId);
        queueLastAppPersistence();

        Graphite.events?.emit('navigation:changed', {
            from: previousApp,
            to: appId
        });

        return true;
    }

    function initialize(initialRoute = 'dashboard') {
        const pages = getPages();
        pages.forEach((page) => {
            page.classList.remove('route-active');
            page.dataset.routeActive = 'false';
            page.setAttribute('aria-hidden', 'true');
        });

        activeRoute = null;
        currentApp = null;
        return navigate(initialRoute);
    }

    return Object.freeze({
        navigate,
        initialize,
        get activeRoute() { return activeRoute; },
        get labels() { return { ...labels }; }
    });
})();

window.GraphiteRouter = GraphiteRouter;

/* Backwards-compatible public API. Existing inline handlers and feature
 * modules continue to call switchApp(), but there is only one router. */
function switchApp(appId) {
    return GraphiteRouter.navigate(appId);
}

function saveGoal() {

    const input = document.getElementById('daily-goal-input');
    if (!input) return;
    state.goal = input.value;
    const display = document.getElementById('active-goal-display');
    if (display) display.innerText = state.goal || "No Goal Set";
    saveDataToDB();
}

