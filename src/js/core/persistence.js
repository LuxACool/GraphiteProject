/* Graphite Persistence Repository
 * The UI never needs to know IndexedDB transaction details.
 */
(function () {
  const Graphite = window.Graphite = window.Graphite || {};
  const DB_NAME = 'StudyOS_DB';
  const DB_VERSION = 8;
  const STORE = 'AppState';
  let db = null;
  let openPromise = null;

  function close() {
    if (db) {
      try { db.close(); } catch (_) {}
      db = null;
    }
  }

  function open() {
    if (db) return Promise.resolve(db);
    if (openPromise) return openPromise;
    openPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (event) => {
        const database = event.target.result;
        if (!database.objectStoreNames.contains(STORE)) {
          database.createObjectStore(STORE, { keyPath: 'id' });
        }
      };
      request.onblocked = () => reject(new Error('Graphite database open is blocked by another tab/window.'));
      request.onerror = () => reject(request.error || new Error('Graphite database could not be opened.'));
      request.onsuccess = () => {
        db = request.result;
        db.onversionchange = () => close();
        db.onclose = () => { db = null; };
        resolve(db);
      };
    }).finally(() => { openPromise = null; });
    return openPromise;
  }

  async function load() {
    const database = await open();
    return new Promise((resolve, reject) => {
      const tx = database.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).get('main');
      request.onsuccess = () => resolve(request.result?.data ?? null);
      request.onerror = () => reject(request.error || new Error('Graphite state could not be loaded.'));
    });
  }

  async function save(data) {
    const database = await open();
    return new Promise((resolve, reject) => {
      const tx = database.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ id: 'main', data });
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error || new Error('Graphite state save failed.'));
      tx.onabort = () => reject(tx.error || new Error('Graphite state save was aborted.'));
    });
  }

  async function reset() {
    close();
    return new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(DB_NAME);
      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error || new Error('Graphite database deletion failed.'));
      request.onblocked = () => reject(new Error('Graphite database deletion is blocked by another open connection.'));
    });
  }

  Graphite.persistence = { open, load, save, reset, close, DB_NAME, DB_VERSION };
})();
