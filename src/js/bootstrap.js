/* ============================================================
   Graphite bootstrap
   ------------------------------------------------------------
   The app used to be one giant HTML file. It is now split into:
     pages/*.html   one file per feature screen
     css/*.css      stylesheets
     js/app/*.js    feature logic (classic scripts, shared globals)
     js/pages/*.js  per-page scripts
   This loader injects the page markup, then loads the feature
   scripts in their original order, then fires DOMContentLoaded /
   load so existing boot hooks still run unchanged.
   NOTE: open the app through a web server (it uses fetch()).
   ============================================================ */
(function () {
  var PAGES = ["dashboard", "pomodoro", "calendar", "notes", "graph", "flashcards", "kanban", "canvas", "sessions", "tutor", "soundscape", "settings"];
  var SCRIPTS = [
    // Core runtime / infrastructure
    "js/core/runtime.js",
    "js/core/persistence.js",
    "js/core/native-bridge.js",
    "js/core/database.js",
    "js/core/assets.js",
    "js/core/repositories.js",
    "js/core/dual-write.js",
    "js/core/migration.js",
    "js/i18n/i18n.js",

    // State + shared services
    "js/pages/settings.js",
    "js/core/state.js",
    "js/features/workspaces.js",
    "js/core/theme.js",
    "js/app/cognitive-kss.js",
    "js/app/focus-wiki-linking.js",

    // Feature modules (split from the former monolith)
    "js/features/navigation.js",
    "js/features/dashboard.js",
    "js/features/notes.js",
    "js/features/graph.js",
    "js/features/flashcards.js",
    "js/features/kanban.js",
    "js/features/pomodoro.js",
    "js/features/canvas.js",

    // Shared UI / cross-cutting features
    "js/core/shortcuts.js",
    "js/ui/modals.js",
    "js/app/enhancement-pack.js",
    "js/rendering/markdown-editor.js",
    "js/app/ai-notes-synthesis.js",
    "js/app/multiple-choice.js",
    "js/core/notifications.js",
    "js/runtime/lifecycle.js"
];
  var PAGE_SCRIPTS = ["js/pages/calendar.js"];

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.async = false;
      s.onload = resolve;
      s.onerror = function () { reject(new Error('Failed to load ' + src)); };
      document.body.appendChild(s);
    });
  }

  async function boot() {
    var host = document.getElementById('app-views');
    var html = await Promise.all(PAGES.map(function (p) {
      return fetch('pages/' + p + '.html').then(function (r) {
        if (!r.ok) throw new Error('Failed to load page: ' + p);
        return r.text();
      });
    }));
    host.innerHTML = html.join('\n');

    for (var i = 0; i < SCRIPTS.length; i++) await loadScript(SCRIPTS[i]);
    if (window.GraphiteI18nReady) await window.GraphiteI18nReady;

    document.dispatchEvent(new Event('DOMContentLoaded', { bubbles: true }));
    window.dispatchEvent(new Event('load'));

    // Page modules initialize after the legacy startup hooks so their
    // dedicated markup and controls cannot be overwritten during boot.
    for (var j = 0; j < PAGE_SCRIPTS.length; j++) await loadScript(PAGE_SCRIPTS[j]);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
