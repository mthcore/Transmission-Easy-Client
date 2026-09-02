/**
 * Fails when a locale is missing a key that exists in `en`.
 *
 * chrome.i18n.getMessage returns '' for a missing key, not the English text, so
 * a gap renders as an EMPTY string in the UI. Some call sites guard with
 * `getMessage(x) || getMessage('unexpectedError')`, but not all: ContextMenu's
 * not-a-torrent notification passes the value straight through and arrives with
 * an empty body.
 *
 * This has now happened twice. Every locale was once missing 35-40% of its
 * strings (fixed by hand in 8881349), and two keys added with the JavaScript
 * download-button feature reached only en and fr. Nothing prevented either
 * recurrence, which is what this check is for.
 *
 * Extra keys are REPORTED but do not fail: an unused translation is dead weight,
 * not a defect, and some locales carry historical variants (ru has three
 * *_SHORT entries with an originalKey pointer).
 */
const fs = require('fs');
const path = require('path');

const LOCALES_DIR = path.join(__dirname, '../src/_locales');
const BASE = 'en';

function readLocale(locale) {
  const file = path.join(LOCALES_DIR, locale, 'messages.json');
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    console.error(`::error file=src/_locales/${locale}/messages.json::unreadable: ${err.message}`);
    return null;
  }
}

function main() {
  const base = readLocale(BASE);
  if (!base) return 1;
  const baseKeys = Object.keys(base);

  const locales = fs
    .readdirSync(LOCALES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((locale) => locale !== BASE)
    .sort();

  let failed = false;

  for (const locale of locales) {
    const messages = readLocale(locale);
    if (!messages) {
      failed = true;
      continue;
    }
    const keys = new Set(Object.keys(messages));
    const missing = baseKeys.filter((key) => !keys.has(key));
    const extra = Object.keys(messages).filter((key) => !base[key]);

    // An entry present but empty is the same defect as an absent one
    const blank = baseKeys.filter((key) => keys.has(key) && !String(messages[key].message ?? '').trim());

    if (missing.length || blank.length) {
      failed = true;
      const detail = [
        missing.length ? `missing ${missing.length}: ${missing.join(', ')}` : '',
        blank.length ? `empty ${blank.length}: ${blank.join(', ')}` : '',
      ]
        .filter(Boolean)
        .join(' | ');
      console.error(`::error file=src/_locales/${locale}/messages.json::${locale} ${detail}`);
    }
    if (extra.length) {
      console.warn(`  ${locale}: ${extra.length} unused key(s): ${extra.join(', ')}`);
    }
  }

  if (failed) {
    console.error(
      `\nEvery key in _locales/${BASE} must exist and be non-empty in all ${locales.length} other locales.`
    );
    return 1;
  }
  console.log(`Locales OK: ${baseKeys.length} keys x ${locales.length + 1} locales.`);
  return 0;
}

process.exit(main());
