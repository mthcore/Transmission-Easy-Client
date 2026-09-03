# Release Notes - Transmission Easy Client

## Version 3.5.0 (September 2026)

**Features the daemon already spoke, and a suite that can see them.** Several
parts of the Transmission protocol were fully implemented in the background and
reachable from no page at all — they now have interfaces. The test suite went
from 490 to 1812, which is what made the rest of this list safe to change.

- **Bandwidth groups** - assign a torrent to a group from its context menu, and
  create or edit groups from a new manager on the Server tab. The extension
  already spoke this part of the protocol; nothing could reach it
  (Transmission 4.0+)
- **Per-torrent speed and peer limits** - a Bandwidth tab in the torrent details
  dialog. The values were shown read-only before and can now be changed. A
  limit's number and whether it applies are separate controls, as the daemon
  stores them, so switching a limit off and back on restores what you chose
  rather than zero
- **Default tracker list** - the list every newly added torrent inherits can be
  edited from Server settings (Transmission 4.0+)
- **File list: search, and large torrents** - the file list now draws only the
  rows on screen, so a season pack or a distro set opens at once instead of
  building thousands of rows, and a name filter finds files without scrolling.
  It ignores accents, so "reglement" finds "règlement"
- **File actions on a whole folder** - "All shown files" applies download,
  skip and priority to everything the current folder and search leave visible.
  Acting on a folder meant selecting every row in it by hand, which on a season
  pack is thousands of clicks
- **Excluding a file no longer discards its priority** - the two were collapsed
  into a single scale where 0 meant "do not download", so a HIGH file that was
  briefly deselected came back as NORMAL with nothing to show it had changed.
  They are now independent, which is how the daemon has always stored them.
  This is a deliberate change in behaviour; nothing saved needs migrating
- **"Add to Transmission" on modern trackers** - sites whose download button
  runs JavaScript instead of linking to a .torrent file offered no menu entry
  at all, and right-clicking the torrent's title instead posted the HTML page
  to the daemon, which answered "invalid or corrupt torrent file". The entry
  now also appears on the page itself and captures the torrent the button
  produces
- **Diagnostics tab** - warnings and errors were compiled out of every released
  build, so a failure was observable by nobody: you see an action quietly not
  happen, and by the time a report is written the console that held the message
  is long gone. Recent ones are now kept and shown under Options → Diagnostics,
  ready to copy into a bug report along with the extension, browser and daemon
  versions. The server address and credentials are stripped out, and the report
  is shown in full before anything is copied
- **Keyboard shortcuts stopped working after clicking a row checkbox** - a
  focused checkbox counts as a text field, so the list shortcuts were disabled
  for the rest of the session, taking select-then-Delete with them
- **Actions that silently did nothing now say so** - context menu items,
  keyboard shortcuts, the speed menus, the toolbar and the status bar all sent
  requests nobody waited on, so a daemon failure produced no message and the
  action simply did not happen
- **Label filter** - selecting a label that no longer exists filtered the list
  down to nothing while the dropdown itself rendered blank, leaving no way to
  see what was filtering or how to stop it
- **Column resizing** - dragging a column edge also started a column reorder;
  releasing the button outside the window left the column following the pointer
  with nothing held down; and in a right-to-left layout, pulling the handle
  outward made the column shrink
- **Theme and text direction** - the options page showed the wrong theme for a
  moment when your choice differs from your system setting, and never set the
  text direction, so Hebrew was laid out left-to-right
- **A broken connection can be repaired again** - the options page used to
  dead-end on "Loading: error" with nothing to press, on the very page you
  would open to fix it. The connection form also accepted pasted values that
  could never connect, and saved them as a hostname
- **Free space and torrent details** no longer end on a raw error string when
  the background is still starting up
- **Security** - a redirect could walk a background request onto loopback or
  your LAN through IPv4-mapped IPv6 addresses; the background now requires a
  sender URL before answering, closing a path that could read the daemon
  password; Web UI credentials now work when the GUI sits at the site root; and
  a cloud backup that hit the storage quota no longer leaves its index pointing
  at data it already deleted
- **All 24 languages complete again** - four strings existed only in English and
  French. A missing string renders as empty rather than falling back to
  English, so those users saw notifications with no text at all
- **Under the hood** - the 44 server settings are now described in one table
  instead of being spelled out in five files, so adding one costs a line rather
  than five chances to disagree; the background's start-up wiring is checked by
  the compiler instead of being cast past it, which surfaced five claims about
  the code that had quietly stopped being true; the labelled switch used across
  the options panes is stated once instead of thirty-three times; the layering
  rules and the Firefox API rule are enforced by the linter rather than by
  memory; and the state libraries moved to their current majors
- **Build and release** - every check now runs before anything reaches the
  stores, and each of the three published bundles is loaded and smoke-tested
  after it is built, so a package that cannot start cannot be published
- **1812 tests** (up from 490)

## Version 3.4.0 (August 2026)

**Deep audit: three review passes, ~150 verified bug fixes.** Every finding was
traced end to end before being fixed, and covered by a test that fails without
the fix.

- **Firefox works again** - the Firefox build declared a background type Firefox
  has never supported, so the add-on could not even be installed; several
  internal calls also used a browser API form that Firefox does not provide,
  which left the extension inert. The published packages were malformed on all
  three stores as well
- **Add-torrent fix** - the folder selected in the add-by-URL and drop-files
  dialogs was silently ignored; torrents landed in the daemon's default
  directory. The chosen folder is now honored on every add path
- **Deleting a torrent is safe** - the confirmation dialog put keyboard focus on
  "Yes" instead of "No", so a reflex Enter could delete a torrent and its data
- **Security** - the Basic-auth header could be injected into every request on
  the server's origin (leaking Transmission credentials to other applications
  behind the same reverse proxy); rules are now scoped to the Transmission
  paths only. Requests are no longer followed onto private/local addresses via
  redirects, downloads are size-limited while they stream, and the background
  only answers this extension's own pages
- **Correct torrent after a daemon restart** - Transmission reuses torrent ids
  between sessions; the selection and open dialogs could end up pointing at a
  different torrent than the one displayed
- **Notifications** - completion notices are no longer missed for torrents that
  finish between two checks, no burst of bogus notices after switching servers
  or restarting the daemon, no repeat after a data verification, and clicking a
  notification opens the extension
- **Speed limits** - the speed menu no longer offers a "0" entry that froze all
  transfers, and every limit is displayed with Transmission's own unit (a
  512 KB/s limit showed as 524.29 kB/s)
- **Values shown correctly** - remaining bytes, infinite share ratio, seeds and
  peers (they were multiplied by the number of trackers), per-file progress,
  session totals, and the active/paused counts
- **Tables** - the file-list folder navigation works again, six columns can be
  resized, the seeds/peers column actually sorts, names sort case-insensitively
  and missing values always sort last
- **Cloud backup** - saves no longer destroy the existing copy, two machines
  syncing at once can't mix their backups, and failures are shown instead of
  passing silently
- **Options** - a seed ratio of 0 can be saved, alt-speed days no longer
  un-check each other, the Server tab refreshes instead of showing stale values,
  failed changes are reported, typing an interval no longer hammers the daemon,
  and opening the badge colour picker no longer changes the badge
- **Network reliability** - timeouts now cover the whole response, operations
  that could be applied twice are never retried, slow .torrent downloads are no
  longer cut off, and the interface no longer reports failure for operations
  that actually succeed
- **Recovery** - a failed startup offers a retry instead of a blank screen, and
  the free-space indicator no longer sticks on "Loading…"
- **Appearance and accessibility** - keyboard focus is visible everywhere,
  dialogs stay above menus, dark mode is readable (no more white flash on
  refresh, unreadable folder chips or progress labels), Hebrew is laid out
  right-to-left, and the "reduce motion" system setting is respected
- **Upgrades from very old versions** restore two settings that were silently
  dropped ("notify on completion" and "hide finished")
- **490 tests** (up from 418)

## Version 3.3.1 (August 2026)

- Fix backup on Cloud.

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
