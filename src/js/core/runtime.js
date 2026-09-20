/* Graphite Core Runtime
 * Stable application primitives shared by every feature.
 * Feature code can remain framework-free while depending on this boundary.
 */
(function () {
  const Graphite = window.Graphite = window.Graphite || {};

  const listeners = new Map();
  Graphite.events = Graphite.events || {
    on(name, handler) {
      if (typeof handler !== 'function') return () => {};
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(handler);
      return () => listeners.get(name)?.delete(handler);
    },
    off(name, handler) { listeners.get(name)?.delete(handler); },
    emit(name, detail) {
      const set = listeners.get(name);
      if (!set) return;
      for (const handler of [...set]) {
        try { handler(detail); } catch (error) { console.error(`[Graphite:event:${name}]`, error); }
      }
    }
  };

  const commands = new Map();
  Graphite.commands = Graphite.commands || {
    register(name, handler) {
      if (!name || typeof handler !== 'function') throw new TypeError('Invalid Graphite command');
      commands.set(name, handler);
      return () => commands.delete(name);
    },
    has(name) { return commands.has(name); },
    async execute(name, payload) {
      const handler = commands.get(name);
      if (!handler) throw new Error(`Unknown Graphite command: ${name}`);
      return handler(payload);
    }
  };

  function getTauri() {
    return window.__TAURI__ || null;
  }

  Graphite.native = Graphite.native || {
    get available() { return !!getTauri()?.core?.invoke; },
    get platform() {
      const t = getTauri();
      return t?.os?.platform?.() || (navigator.userAgentData?.platform || navigator.platform || 'web').toLowerCase();
    },
    async invoke(command, args) {
      const invoke = getTauri()?.core?.invoke;
      if (!invoke) throw new Error(`Native command unavailable outside Tauri: ${command}`);
      return invoke(command, args);
    },
    async listen(eventName, handler) {
      const listen = getTauri()?.event?.listen;
      if (!listen) return () => {};
      return listen(eventName, handler);
    }
  };

  Graphite.lifecycle = Graphite.lifecycle || {
    started: false,
    start() {
      if (this.started) return;
      this.started = true;
      Graphite.events.emit('app:started');
    }
  };

  window.addEventListener('error', (event) => {
    console.error('[Graphite]', event.error || event.message);
    Graphite.events.emit('app:error', { error: event.error, message: event.message });
  });
  window.addEventListener('unhandledrejection', (event) => {
    console.error('[Graphite] Unhandled promise rejection:', event.reason);
    Graphite.events.emit('app:error', { error: event.reason });
  });
})();
