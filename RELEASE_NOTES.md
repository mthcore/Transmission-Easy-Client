# Release Notes - Transmission Easy Client

## Version 3.4.0 (August 2026)

**Deep audit pass: 25 verified bug fixes.** A full-codebase review with every
finding traced end-to-end before fixing.

- **Add-torrent fix** - the folder selected in the add-by-URL and drop-files
  dialogs was silently ignored; torrents landed in the daemon's default
  directory. The chosen folder is now honored on every add path
- **Security** - with no "GUI path" configured, the Basic-auth header was
  injected into every request on the server's origin; on a shared host behind
  a reverse proxy this leaked Transmission credentials to co-hosted
  applications. Rules are now scoped to the Transmission paths only
- **Cloud backup** - saving an emptied config text area no longer destroys the
  existing cloud backup; save/restore failures now show a visible error
- **Network reliability** - the RPC timeout now covers the whole response (a
  proxy stalling mid-body used to hang background polling until the service
  worker died); operations that could be applied twice are no longer retried
  after a timeout; the UI no longer reports failure for slow operations that
  later succeed
- **UI fixes** - blank-page crash when the first background sync failed;
  Ctrl+O now opens the file picker instead of doing nothing; Escape closes one
  dialog at a time instead of the whole stack; the label filter dropdown stays
  in sync with the applied filter; reordering context-menu folders no longer
  scrambles them or crashes; recheck progress, speed graph, free-space display
  and details-dialog durations corrected
- **Options hardening** - typing an interval no longer hammers the daemon at
  millisecond rates mid-keystroke, and a too-small background interval can no
  longer silently kill badge updates and notifications
- **435 tests** (up from 418), including regression tests for every fix above

## Version 3.3.0 (August 2026)

**Transmission 4.x support & security hardening.** A full audit pass covering
protocol compatibility, credential handling, and dozens of latent bugs.

- **Transmission 4.0-4.2 support, with 2.x/3.x compatibility kept** - the
  client now reports the daemon's RPC version and gates every 4.x-only
  feature on it instead of guessing; older daemons keep working exactly as
  before
- **Sequential download** - new toggle in the torrent context menu (Transmission 4.1+)
- **Daemon version** shown in Server settings; file count and content type shown in torrent details (Transmission 4.0+)
- **Web UI login fixed** - opening the Web UI tab from the popup no longer shows an empty torrent list on first load; credentials are now injected as a request header instead of being embedded in the URL (which also stopped leaking the password into the browser's address bar and history)
- **Backup/restore hardened** - restoring a backup validates its content and warns before it silently repoints the extension at a different server
- **All 24 languages fully translated** - every locale was previously missing 35-40% of its strings and falling back to English; all locales now match, letter for letter
- **Crash fix** - Server settings could crash on load ("Rendered fewer hooks than expected") right after opening a fresh profile; fixed and covered by a regression test
- **Correctness fixes**: port test for IPv6, ETA display for stalled/unknown torrents, upload ratio rounding, several background actions that could hang instead of reporting an error after a browser restart
- **Security**: safer parsing of daemon responses, tightened Web UI authentication scope, pinned release-pipeline dependencies
- **351 tests** (up from 157), covering the sync protocol between the extension's background and UI, the message dispatcher, folder-tree building, and the first React component tests

## Version 3.2.0 (February 2026)

- **Torrent Details dialog** - New tabbed interface (Info, Trackers, Seed Limits) with detailed torrent info: creator, creation date, pieces, time seeding/downloading, webseeds, and more
- **Tracker management** - View tracker stats (seeds, peers, status per tracker) and edit the tracker list directly from the dialog
- **Per-torrent seed limits** - Set custom ratio and idle limits per torrent (Global / Custom / Unlimited)
- **Label filtering** - Filter torrents by label in the category selector, including a "No Label" option
- **Server settings** - 17 new Transmission settings: queue limits, incomplete directory, alt-speed schedule, post-download script, and more
- **Resizable columns** - Peer and tracker table columns can be resized by dragging, with persistent widths
- **Selectable text** - Torrent details (hash, path, etc.) can now be selected and copied
- **Network resilience** - Automatic retry with exponential backoff on network errors
- **98 tests** - Expanded test suite covering TorrentStore and TorrentListStore

## Version 3.1.1 (February 2026)

- **Fixed "Rename" context menu** - Dialog now opens correctly

## Version 3.1.0 (January 2026)

- **Full TypeScript migration** - 97 files converted from JavaScript/JSX to TypeScript/TSX
- **Constants extraction** - Hardcoded values moved to `src/constants.ts`
- **Dark mode** with system preference detection
- **Search bar** to filter torrents by name
- **Keyboard shortcuts** for power users
- Progress bar with dynamic text color
- Bug fixes

## Version 3.0.0

Major modernization since fork:

- Manifest V3 migration
- React 19, MobX 6, Webpack 5
- Radix UI context menus
- SCSS architecture (replaced LESS)
- SVG icons (replaced PNG)
- GitHub Actions CI/CD

## Version 2.2.2 (Original)

Last version from [Feverqwe/Transmission](https://github.com/Feverqwe/Transmission).
