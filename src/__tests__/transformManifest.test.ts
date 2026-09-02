import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// The builder is plain CommonJS: it runs under Node during the webpack build,
// not through the bundler.
const transformManifest = require('../../builder/transformManifest') as (
  manifest: Record<string, unknown>,
  browser: string,
  env?: Record<string, string | undefined>
) => Record<string, unknown>;

/**
 * This is the code that decides whether the add-on can be INSTALLED. It has
 * been wrong before: a Firefox build once declared a background type Firefox
 * has never supported and could not be installed at all, while the whole test
 * suite passed — because the suite runs through Vitest's transform pipeline,
 * never webpack's.
 *
 * Every assertion below corresponds to a documented store requirement or to a
 * defect that actually shipped. None of them is style.
 */

const SOURCE = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../manifest.json'), 'utf8')
) as Record<string, unknown>;

type Gecko = {
  gecko: {
    id: string;
    strict_min_version: string;
    data_collection_permissions: { required: string[] };
  };
  gecko_android: { strict_min_version: string };
};

describe('transformManifest — Chrome and Opera', () => {
  it.each(['chrome', 'opera'])('ships src/manifest.json verbatim for %s', (browser) => {
    expect(transformManifest(SOURCE, browser, {})).toEqual(SOURCE);
  });

  it('keeps minimum_chrome_version, which gates the MAIN-world capture', () => {
    // chrome.scripting world:'MAIN' needs Chrome 111; dropping this floor would
    // let the extension install where the capture silently cannot work.
    const out = transformManifest(SOURCE, 'chrome', {});
    expect(out.minimum_chrome_version).toBe(SOURCE.minimum_chrome_version);
  });
});

describe('transformManifest — Firefox', () => {
  const firefox = () => transformManifest(SOURCE, 'firefox', {});

  it('replaces the service worker with a classic background script', () => {
    // Firefox has no extension service workers: an MV3 add-on declaring only
    // background.service_worker is REJECTED at install. This exact defect
    // shipped once (commit 0f77a9b).
    const out = firefox();
    expect(out.background).toEqual({
      scripts: [(SOURCE.background as { service_worker: string }).service_worker],
    });
    expect(out.background).not.toHaveProperty('service_worker');
  });

  it('drops minimum_chrome_version, which is meaningless to Firefox', () => {
    expect(firefox()).not.toHaveProperty('minimum_chrome_version');
  });

  it('sets a gecko id — a missing one is a hard ADDON_ID_REQUIRED error on AMO', () => {
    const bss = firefox().browser_specific_settings as Gecko;
    expect(bss.gecko.id).toBe('transmission-easy-client@mthcore');
  });

  it('takes the id from FIREFOX_ADDON_ID, which must equal the AMO listing GUID', () => {
    // The release workflow passes the same secret as FIREFOX_ADDON_GUID to the
    // upload step; a mismatch fails validation after the tag already exists.
    const out = transformManifest(SOURCE, 'firefox', { FIREFOX_ADDON_ID: 'real@guid' });
    expect((out.browser_specific_settings as Gecko).gecko.id).toBe('real@guid');
  });

  it('declares the version floors AMO needs for host permissions and consent data', () => {
    const bss = firefox().browser_specific_settings as Gecko;
    // 140 is the first release where BOTH work: host permissions granted at
    // install (127+) and data_collection_permissions (140+).
    expect(bss.gecko.strict_min_version).toBe('140.0');
    // Android got data_collection_permissions two releases later
    expect(bss.gecko_android.strict_min_version).toBe('142.0');
  });

  it('declares that nothing is collected — required by AMO since 2025-11', () => {
    const bss = firefox().browser_specific_settings as Gecko;
    expect(bss.gecko.data_collection_permissions).toEqual({ required: ['none'] });
  });

  it('adds clipboardWrite, which Chrome grants implicitly but Firefox does not', () => {
    const out = firefox();
    const source = SOURCE.permissions as string[];
    expect(out.permissions).toEqual([...source, 'clipboardWrite']);
    // Everything the source declared must survive
    for (const permission of source) expect(out.permissions).toContain(permission);
  });

  it('changes nothing else', () => {
    const out = firefox();
    const untouched = Object.keys(SOURCE).filter(
      (key) => !['background', 'permissions', 'minimum_chrome_version'].includes(key)
    );
    for (const key of untouched) {
      expect(out[key], `${key} was modified`).toEqual(SOURCE[key]);
    }
  });
});

describe('transformManifest — purity', () => {
  it('does not mutate the manifest it is given', () => {
    // webpack calls this per emitted file; a mutating transform would leak the
    // Firefox rewrite into a subsequent Chrome build in the same process.
    const input = JSON.parse(JSON.stringify(SOURCE));
    const before = JSON.stringify(input);
    transformManifest(input, 'firefox', {});
    expect(JSON.stringify(input)).toBe(before);
  });

  it('does not read process.env when an env is supplied', () => {
    const previous = process.env.FIREFOX_ADDON_ID;
    process.env.FIREFOX_ADDON_ID = 'from-process-env';
    try {
      const out = transformManifest(SOURCE, 'firefox', {});
      expect((out.browser_specific_settings as Gecko).gecko.id).toBe(
        'transmission-easy-client@mthcore'
      );
    } finally {
      if (previous === undefined) delete process.env.FIREFOX_ADDON_ID;
      else process.env.FIREFOX_ADDON_ID = previous;
    }
  });
});

describe('transformManifest — the manifest it is fed', () => {
  it('src/manifest.json still has the shape the transform assumes', () => {
    // If the source stops declaring a service worker, the Firefox branch would
    // emit `scripts: [undefined]` and produce an add-on that installs but does
    // nothing. Fail here instead.
    expect(SOURCE.background).toHaveProperty('service_worker');
    expect(Array.isArray(SOURCE.permissions)).toBe(true);
    expect(SOURCE.manifest_version).toBe(3);
  });
});
