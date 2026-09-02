/**
 * Loads a BUILT page and asserts it actually mounts.
 *
 * This closes the one defect class the unit suite structurally cannot see.
 * Vitest transforms sources with its own pipeline; it never runs webpack or
 * Babel as configured for production. Babel 8 once emitted `jsxDEV` calls into
 * the production bundle — every page crashed at runtime while the whole test
 * suite stayed green. Nothing in the repo would have caught that.
 *
 * So: take the real emitted bundle, run it in jsdom with a minimal chrome
 * stub, and require that React put something inside #root.
 *
 * Usage: node builder/smokeTest [--browser chrome]
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const getArgvValue = require('./getArgvValue');

const browser = process.env.BROWSER || getArgvValue('--browser') || 'chrome';
const distDir = path.join(__dirname, `../dist/${browser}/src`);

/**
 * The real `en` message table, read from the build output.
 *
 * Not a stub returning '': tools/format.ts does
 * `JSON.parse(chrome.i18n.getMessage('sizeList'))` at MODULE LOAD, so an empty
 * answer throws and every module importing it fails to load. Serving the real
 * table keeps this test faithful to production. The fragility is real though:
 * a locale packaging error would take the whole UI down rather than merely
 * degrade formatting.
 */
function messages() {
  const file = path.join(distDir, '_locales/en/messages.json');
  if (!fs.existsSync(file)) return {};
  const table = JSON.parse(fs.readFileSync(file, 'utf8'));
  return Object.fromEntries(Object.entries(table).map(([key, value]) => [key, value.message]));
}

/** Just enough chrome.* for the entry points' module-level calls. */
function chromeStub() {
  const noop = () => {};
  const table = messages();
  const area = {
    get: (_keys, cb) => cb && cb({}),
    set: (_items, cb) => cb && cb(),
    remove: (_keys, cb) => cb && cb(),
  };
  return {
    runtime: {
      id: 'smoke-test',
      lastError: null,
      getURL: (p) => `chrome-extension://smoke-test/${p}`,
      sendMessage: (_message, cb) => cb && cb({ result: null }),
      onMessage: { addListener: noop, removeListener: noop },
      openOptionsPage: noop,
    },
    storage: { local: area, session: area, sync: area, onChanged: { addListener: noop, removeListener: noop } },
    i18n: {
      getMessage: (key) => table[key] ?? '',
      getUILanguage: () => 'en',
    },
    notifications: { create: noop, clear: noop, onClicked: { addListener: noop } },
    tabs: { create: noop, sendMessage: noop },
    action: { setBadgeText: noop, setBadgeBackgroundColor: noop },
    alarms: { create: noop, clear: noop, onAlarm: { addListener: noop } },
    contextMenus: {
      create: (_d, cb) => cb && cb(),
      removeAll: (cb) => cb && cb(),
      onClicked: { addListener: noop, hasListener: () => false },
    },
    declarativeNetRequest: { updateDynamicRules: (_o, cb) => cb && cb() },
    scripting: { executeScript: (_i, cb) => cb && cb([]) },
  };
}

async function smoke(pageFile) {
  const htmlPath = path.join(distDir, pageFile);
  if (!fs.existsSync(htmlPath)) {
    return { page: pageFile, ok: false, reason: `not built: ${htmlPath}` };
  }
  const html = fs.readFileSync(htmlPath, 'utf8');

  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (err) => errors.push(err.message));
  virtualConsole.on('error', (...args) => errors.push(args.join(' ')));

  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'chrome-extension://smoke-test/index.html',
    virtualConsole,
  });
  const { window } = dom;
  window.chrome = chromeStub();
  // The bundles target browsers that have these; jsdom is close enough that
  // only the extension APIs need stubbing.
  window.matchMedia =
    window.matchMedia || (() => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }));

  // Scripts are referenced with plain relative srcs; jsdom will not fetch them
  // from disk, so they are executed here in document order.
  const sources = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]);
  if (!sources.length) {
    return { page: pageFile, ok: false, reason: 'no <script src> found in the built page' };
  }
  for (const src of sources) {
    const file = path.join(distDir, src);
    if (!fs.existsSync(file)) {
      return { page: pageFile, ok: false, reason: `missing bundle ${src}` };
    }
    try {
      window.eval(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      return { page: pageFile, ok: false, reason: `${src} threw at load: ${err.message}` };
    }
  }

  const root = window.document.getElementById('root');
  if (!root) return { page: pageFile, ok: false, reason: 'no #root element in the built page' };

  // React 19 renders concurrently: createRoot().render() SCHEDULES work rather
  // than committing it synchronously, so #root is still empty on the next line.
  // Wait for real frames (pretendToBeVisual gives jsdom requestAnimationFrame)
  // and give up after a bounded number rather than hanging.
  for (let frame = 0; frame < 30 && !root.childNodes.length; frame++) {
    await new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  if (!root.childNodes.length) {
    return {
      page: pageFile,
      ok: false,
      reason: `#root is empty after loading ${sources.length} bundle(s)` +
        (errors.length ? ` — first error: ${errors[0]}` : ' — no error was reported'),
    };
  }
  return { page: pageFile, ok: true, mounted: root.childNodes.length, bundles: sources.length };
}

async function main() {
  const results = [await smoke('index.html'), await smoke('options.html')];
  let failed = false;
  for (const result of results) {
    if (result.ok) {
      console.log(`  OK  ${browser}/${result.page}: mounted (${result.bundles} bundles)`);
    } else {
      failed = true;
      console.error(`::error::smoke test failed for ${browser}/${result.page}: ${result.reason}`);
    }
  }
  if (failed) {
    console.error(
      '\nA built page did not mount. The unit suite cannot see this class of defect ' +
        '(it never runs the production webpack/Babel pipeline).'
    );
    return 1;
  }
  console.log(`Smoke test OK: ${browser} pages mount.`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(`::error::smoke test crashed: ${err && err.stack ? err.stack : err}`);
    process.exit(1);
  }
);
