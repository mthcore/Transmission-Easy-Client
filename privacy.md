# Privacy Policy - Transmission Extension

**Last updated: August 2026**

## Data Collection
This extension does NOT collect, store, or transmit any personal data.

## Local Storage
The extension stores your Transmission server settings (URL, port, credentials)
locally in your browser using Chrome's storage API. This data stays on your device,
with one exception: if you explicitly use the optional cloud backup feature
(Options → Backup/Restore → "Save in cloud"), your settings — including your server
login and password — are stored in your browser account's sync storage
(e.g. your Google or Firefox account). You can clear this backup at any time from
the same page.

## Network Requests
The extension talks to YOUR Transmission server at the address you configure. Your
credentials are only ever sent there.

It also makes requests to other sites in exactly two cases, both started by you:

- **Adding a torrent from a link.** When you use "Add in torrent client" from the
  right-click menu, or paste a URL in the add dialog, the extension downloads that
  `.torrent` file from the site it points to and forwards it to your server. To read
  links on pages that require your session (private trackers), it runs a small script
  in the current tab to perform that download; the script only fetches the URL you
  clicked and returns the file. This is why the extension requests access to websites.
- **Adding a torrent from a download button.** Some trackers have no link to
  right-click: their download button builds the `.torrent` in the page with
  JavaScript. To support them, a tiny script on every page remembers only which
  element you last right-clicked (nothing is read, stored or sent), and when you
  choose "Add in torrent client" on such a button the extension re-triggers that
  button and captures the torrent file the page produces, instead of saving it
  to disk. This happens only for that one action and only in that tab.
- **No analytics, telemetry or third-party services.** Nothing is sent anywhere else,
  and no browsing data is collected, stored or shared.

Requests are not followed onto private/local network addresses (for example
`127.0.0.1` or `192.168.x.x`) via redirects, and downloads are size-limited.

## Contact
For questions, open an issue on GitHub.
