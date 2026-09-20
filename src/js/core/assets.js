/* Filesystem-backed assets facade. Large/binary content lives outside SQLite;
 * SQLite stores metadata and references. Browser builds fail clearly rather
 * than pretending they have native filesystem access. */
(function () {
  const Graphite = window.Graphite = window.Graphite || {};
  Graphite.assets = Graphite.assets || {};
  const native = () => Boolean(Graphite.native?.available);
  const requireNative = () => { if (!native()) throw new Error('Filesystem assets require the native Tauri runtime.'); };

  Graphite.assets.root = async () => { requireNative(); return Graphite.native.invoke('asset_root'); };
  Graphite.assets.write = async ({ category, relativePath, bytes }) => {
    requireNative();
    if (!(bytes instanceof Uint8Array) && !Array.isArray(bytes)) throw new TypeError('bytes must be a Uint8Array or number array');
    return Graphite.native.invoke('asset_write', { category, relativePath, bytes: Array.from(bytes) });
  };
  Graphite.assets.read = async ({ category, relativePath }) => {
    requireNative();
    const bytes = await Graphite.native.invoke('asset_read', { category, relativePath });
    return new Uint8Array(bytes || []);
  };
  Graphite.assets.remove = async ({ category, relativePath }) => {
    requireNative();
    return Graphite.native.invoke('asset_delete', { category, relativePath });
  };
})();
