# Graphite updater setup and release guide

Graphite now has an in-app updater boundary backed by the official Tauri updater plugin. The updater is intentionally **desktop-only**: Windows, macOS, and Linux AppImage are supported by the Tauri updater plugin. Android and iOS builds should be distributed through their normal app-store/platform update mechanisms.

## What is already wired

- `tauri-plugin-updater` is registered for desktop builds.
- `bundle.createUpdaterArtifacts` is enabled.
- Graphite exposes `updater_status`, `updater_check`, and `updater_install` commands.
- The Settings → About panel has **Check for updates** and **Download & Install** controls.
- Update installation is signature-verified by Tauri before installation.
- Windows uses the configured passive installer mode.
- macOS/Linux request an application restart after a successful install.
- Startup update checks are non-blocking and fail silently if the updater is not configured or the network is unavailable.

The implementation uses the native command boundary instead of adding a frontend npm dependency for the updater plugin.

## 1. Generate the signing key pair

Run from the Graphite project root:

```bash
npm run tauri signer generate -- -w ~/.tauri/graphite.key
```

Or, if you use the Cargo Tauri CLI:

```bash
cargo tauri signer generate -w ~/.tauri/graphite.key
```

The command creates a private signing key and prints/creates the corresponding public key. **Never commit or upload the private key.** If the private key is lost, existing installed Graphite versions cannot be updated with a new key.

## 2. Configure the public key and endpoint

Open:

```text
src-tauri/tauri.conf.json
```

Replace:

```json
"pubkey": "REPLACE_WITH_GRAPHITE_PUBLIC_KEY"
```

with the complete public key content. The public key is safe to ship inside the app.

Then replace:

```text
https://github.com/REPLACE_WITH_OWNER/graphite/releases/latest/download/latest.json
```

with the URL where the signed `latest.json` manifest will be published.

A static JSON manifest is the simplest release model. Tauri expects the manifest to contain a version plus a signed URL for each supported updater target. See the official Tauri updater documentation for the exact manifest shape.

## 3. Keep the private key outside the repository

Before building a release, set the signing key environment variables in the build environment.

Linux/macOS:

```bash
export TAURI_SIGNING_PRIVATE_KEY="$HOME/.tauri/graphite.key"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="YOUR_KEY_PASSWORD"
```

PowerShell:

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY="$HOME/.tauri/graphite.key"
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD="YOUR_KEY_PASSWORD"
```

Do not put these values in `tauri.conf.json`, source code, `.env` files committed to Git, or the frontend.

## 4. Bump the version for every release

Update the version in both places:

```text
src-tauri/Cargo.toml
src-tauri/tauri.conf.json
```

For example:

```text
0.1.0 → 0.1.1
```

The updater normally installs only a version newer than the currently installed version.

## 5. Build signed updater artifacts

After setting the signing environment variables:

```bash
npm run tauri -- build
```

The updater artifacts are generated alongside the normal bundles. The exact files depend on the target platform.

### Windows

Tauri can generate signed updater artifacts for NSIS/MSI. Windows automatically exits the app when the updater installer is launched.

### macOS

Tauri generates a signed `.tar.gz` updater bundle. The app needs to relaunch after installation.

### Linux

The Tauri updater uses the **AppImage** updater artifact. This is important: the built-in updater does not automatically update `.deb` or `.rpm` packages.

Therefore Graphite should treat:

- AppImage → automatic in-app updates
- `.deb` → manual package update/reinstall
- `.rpm` → manual package update/reinstall

If you want automatic RPM/DEB updating later, that requires a separate package-distribution/update strategy.

## 6. Publish the manifest and artifacts

For every release, publish:

1. the generated update bundles
2. their `.sig` signatures
3. a `latest.json` manifest containing the matching URL + signature for each platform/architecture

The URL in `tauri.conf.json` must resolve to the manifest. The manifest's artifact URLs must be HTTPS and publicly reachable by installed Graphite clients.

## 7. Test before publishing a release

Use two installed versions:

```text
Graphite 0.1.0  ← old installed build
Graphite 0.1.1  ← release artifact
```

Test:

- Settings → About → Check for updates
- update appears with correct version
- update notes render correctly
- download progress does not freeze the UI
- signature verification succeeds
- installation succeeds
- app restarts correctly
- SQLite/user data remains intact after the update
- theme, workspace, notes, tasks, calendar, etc. remain intact

Also test the **no update available** path and an unreachable update endpoint. A network failure must not prevent Graphite from starting.

## 8. Mobile update strategy

The Tauri updater plugin currently supports Windows, Linux, and macOS, not Android/iOS. Graphite therefore reports the updater as unsupported on mobile instead of trying to install a desktop bundle.

For mobile releases:

- Android: publish updates through the Android distribution channel you choose.
- iOS: publish updates through Apple's normal distribution/update process.

Do not point the desktop updater at Android/iOS artifacts.

## 9. Key rotation

Treat the updater private key as release infrastructure. Keep it in a secure password manager/CI secret store with a backup.

If key rotation is ever necessary, plan it before shipping a release because installed clients trust the public key embedded in the version they already have. Do not simply replace the key and assume all existing installations will accept future releases.

## 10. Recommended release checklist

```text
[ ] bump version
[ ] verify Cargo.toml and tauri.conf.json versions match
[ ] run tests/checks
[ ] set TAURI_SIGNING_PRIVATE_KEY in the release environment
[ ] set TAURI_SIGNING_PRIVATE_KEY_PASSWORD if used
[ ] build signed artifacts
[ ] verify .sig files exist
[ ] build/update latest.json
[ ] upload artifacts + signatures + manifest
[ ] install previous version in a clean test environment
[ ] check for update
[ ] install update
[ ] verify SQLite/data persistence
[ ] verify app restart
[ ] verify Windows/macOS/Linux targets
[ ] publish release
```

## Official references

- Tauri updater documentation: https://v2.tauri.app/plugin/updater/
- Tauri notification documentation: https://v2.tauri.app/plugin/notification/

This project intentionally does not contain a real updater private key. You must generate and protect your own key before the first public release that uses automatic updates.
