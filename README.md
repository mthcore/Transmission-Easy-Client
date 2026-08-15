# Transmission Easy Client

A browser extension that adds a Transmission WebUI directly in your web browser. Manage your torrents without leaving your browser.

> **Forked from [Feverqwe/Transmission](https://github.com/Feverqwe/Transmission)**

## Features

- Add torrents via URL, magnet links, or torrent files
- Context menu integration for quick torrent adding
- Real-time torrent status monitoring
- Speed graphs and statistics
- File priority management
- Label/category organization
- Multiple download directories support
- Notifications on download completion
- Alternative speed limits (turtle mode)
- Cloud settings sync
- **Dark mode** with system preference detection
- **Search/filter** torrents by name
- **Keyboard shortcuts** for power users
- **Transmission 4.x support** - sequential download toggle, daemon version display, file count/content type in torrent details, while staying fully compatible with older 2.x/3.x daemons
- **Torrent Details dialog** with tabbed info, tracker management, and per-torrent seed limits
- Secure Web UI login (no credentials in the URL) and hardened backup/restore

## Supported Browsers

- Google Chrome (101+)
- Mozilla Firefox (113+)
- Opera

## Supported Languages

All 24 languages are fully translated: Czech, Danish, Dutch, English, French,
German, Greek, Hebrew, Hungarian, Indonesian, Italian, Norwegian Bokmål,
Polish, Portuguese (Brazil), Romanian, Russian, Simplified Chinese, Spanish,
Swedish, Thai, Traditional Chinese, Turkish, Ukrainian, Vietnamese.

## Installation

### From Source

```bash
# Clone the repository
git clone https://github.com/mthcore/Transmission-Easy-Client.git
cd Transmission-Easy-Client

# Install dependencies
npm install

# Build for all browsers
npm run release
```

The built extension will be in the `./dist` folder.

### Build Commands

| Command                  | Description                        |
| ------------------------ | ---------------------------------- |
| `npm run build`          | Build for Chrome (production)      |
| `npm run build:firefox`  | Build for Firefox (production)     |
| `npm run build:opera`    | Build for Opera (production)       |
| `npm run watch`          | Build for Chrome with watch mode   |
| `npm run watch:firefox`  | Build for Firefox with watch mode  |
| `npm run release`        | Build and package for all browsers |

## Configuration

1. Click on the extension icon and go to **Options**
2. Configure your Transmission server:
   - **IP Address**: Your Transmission server address
   - **Port**: RPC port (default: 9091)
   - **Path**: RPC path (default: /transmission/rpc)
   - **Username/Password**: If authentication is enabled
   - **Use SSL**: Enable for HTTPS connections

## Usage

- **Popup**: Click the extension icon to view and manage torrents
- **Context Menu**: Right-click on any torrent/magnet link to add it
- **Drag & Drop**: Drag torrent files onto the popup
- **Search**: Click the magnifying glass icon to filter torrents by name

## Keyboard Shortcuts

| Shortcut | Action |
| -------- | ------ |
| `R` | Refresh torrent list |
| `Ctrl+A` | Select/deselect all torrents |
| `Ctrl+U` | Add torrent from URL |
| `Delete` | Remove selected torrents |
| `Enter` | Start/stop selected torrents |
| `Escape` | Close dialogs or file list |

---

## Changelog

> See [RELEASE_NOTES.md](RELEASE_NOTES.md) for the full release history.

### Version 3.3.0 (August 2026)

- **Transmission 4.0-4.2 support**, with 2.x/3.x compatibility kept
- **Sequential download** toggle, daemon version display, file count/content type in torrent details
- **Web UI login fixed** and hardened - credentials injected as a header instead of leaking into the URL
- **Backup/restore hardened**, with validation before repointing the extension at a different server
- **All 24 languages fully translated**
- Crash fix on the Server settings page, plus numerous correctness and security fixes
- 351 tests (up from 157)

### Version 3.2.0 (February 2026)

- **Torrent Details dialog** with tabbed info (Info, Trackers, Seed Limits)
- **Tracker management** and **per-torrent seed limits**
- **Label filtering**, **resizable columns**, and 17 new server settings

### Version 2.2.2 (Original)

Last version from [Feverqwe/Transmission](https://github.com/Feverqwe/Transmission).

---

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Credits

- Original project by [Feverqwe](https://github.com/Feverqwe)
- Fork maintained by [mthcore](https://github.com/mthcore)
