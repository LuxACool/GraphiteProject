/* SQLite boundary for Graphite.
 *
 * This module deliberately does not expose SQL to feature code. Features should
 * depend on domain repositories once migration begins. For now it provides a
 * small health/initialization boundary so the Rust database can land safely
 * before the IndexedDB -> SQLite data migration is enabled.
 */
(function () {
  const Graphite = window.Graphite = window.Graphite || {};
  Graphite.database = Graphite.database || {};

  function invoke(command, args) {
    if (Graphite.native?.available) return Graphite.native.invoke(command, args);
    throw new Error('SQLite is only available in the Tauri desktop/mobile build.');
  }

  Graphite.database.initialize = () => invoke('database_initialize');
  Graphite.database.info = () => invoke('database_info');
  Graphite.database.isAvailable = () => Boolean(Graphite.native?.available);
  Graphite.database.reset = () => invoke('database_reset');
})();
