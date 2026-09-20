/* Native services facade. Every call has a browser-safe fallback. */
(function () {
  const Graphite = window.Graphite = window.Graphite || {};
  Graphite.services = Graphite.services || {};

  Graphite.services.system = {
    async info() {
      if (!Graphite.native.available) {
        return { runtime: 'webview', platform: navigator.userAgentData?.platform || navigator.platform || 'unknown' };
      }
      return Graphite.native.invoke('system_info');
    }
  };

  Graphite.services.backup = {
    async create(payload) {
      if (!Graphite.native.available) throw new Error('Native backups are unavailable in this browser build.');
      const data = payload === undefined ? (window.Graphite?.getState?.() || {}) : payload;
      return Graphite.native.invoke('create_backup', { payload: JSON.stringify(data) });
    },
    async restore() {
      if (!Graphite.native.available) throw new Error('Native backups are unavailable in this browser build.');
      return Graphite.native.invoke('read_latest_backup');
    },
    async snapshot() {
      if (!Graphite.native.available) throw new Error('Native backups are unavailable in this browser build.');
      const data = window.Graphite?.getState?.() || {};
      return Graphite.native.invoke('create_full_backup', { payload: JSON.stringify(data) });
    },
    async latestSnapshot() {
      if (!Graphite.native.available) throw new Error('Native backups are unavailable in this browser build.');
      return Graphite.native.invoke('read_latest_full_backup');
    }
  };
})();
