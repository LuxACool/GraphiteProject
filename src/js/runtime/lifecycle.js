/* Graphite application lifecycle. Loaded after legacy feature functions exist. */
window.addEventListener('load', () => {
  window.graphiteReady = window.graphiteReady || initDB();
  window.graphiteReady.then(async () => {
    // SQLite authority/fallback selection is completed during state bootstrap.
    const G = window.Graphite;
    if (G?.commands) {
      G.commands.register('navigation.go', ({ appId }) => switchApp(appId));
      G.commands.register('state.save', () => saveDataToDB());
      G.commands.register('backup.create', () => G.services.backup.create());
      G.commands.register('backup.restore', () => G.services.backup.restore());
    }
    if (window.NotifSystem) NotifSystem.init();
    G?.lifecycle?.start();
  }).catch(error => {
    console.error('Graphite startup failed:', error);
    window.Graphite?.events?.emit('app:error', { error });
  });
});

window.addEventListener('pagehide', () => { window.Graphite?.dualWrite?.flush?.(); });
window.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') window.Graphite?.dualWrite?.flush?.(); });
