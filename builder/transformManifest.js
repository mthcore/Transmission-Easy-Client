/**
 * Per-browser manifest rewrite, extracted from webpack.config.js so it can be
 * tested.
 *
 * This code decides whether the add-on can be INSTALLED at all, and it has got
 * that wrong before: a Firefox build once declared a background type Firefox
 * has never supported and could not be installed, while every test passed.
 * The test suite runs through Vitest's transform pipeline, never webpack's, so
 * a defect here is structurally invisible to it — unless the logic is a plain
 * function, which is what this file is for.
 *
 * Pure by contract: no I/O, no webpack, no mutation of its input. `env` is
 * passed in rather than read from `process.env` so the tests do not have to
 * mutate global state.
 *
 * @param {object} manifest  parsed src/manifest.json (not mutated)
 * @param {string} browser   'chrome' | 'firefox' | 'opera'
 * @param {object} [env]     defaults to process.env
 * @returns {object} the manifest to emit
 */
function transformManifest(manifest, browser, env = process.env) {
  if (browser !== 'firefox') {
    // Chrome and Opera ship src/manifest.json verbatim.
    return manifest;
  }

  const result = { ...manifest };

  // Chrome-specific and meaningless to Firefox
  delete result.minimum_chrome_version;

  // Firefox has no extension service workers: an MV3 add-on declaring only
  // background.service_worker is REJECTED at install ("background.service_worker
  // is currently disabled"). The bundle is a classic script, so an event page
  // runs it as-is.
  result.background = {
    scripts: [manifest.background.service_worker],
  };

  // addons-linter makes a missing id a hard ERROR on MV3 (ADDON_ID_REQUIRED),
  // so AMO rejects the upload at validation. It MUST equal the GUID of the
  // existing AMO listing, which the release workflow also passes as
  // FIREFOX_ADDON_GUID — set that same value in FIREFOX_ADDON_ID for release
  // builds; the default below only keeps local builds lintable.
  const addonId = env.FIREFOX_ADDON_ID || 'transmission-easy-client@mthcore';
  result.browser_specific_settings = {
    gecko: {
      id: addonId,
      // 140 is the first release where BOTH pieces work: host permissions
      // granted at install (127+) and the data collection metadata below
      // (140+). Declaring 127 made addons-linter warn that the consent data
      // is ignored.
      strict_min_version: '140.0',
      // Required by AMO since 2025-11: declare that nothing is collected
      data_collection_permissions: {
        required: ['none'],
      },
    },
    // Android got data_collection_permissions two releases later
    gecko_android: {
      strict_min_version: '142.0',
    },
  };

  // navigator.clipboard.writeText outside a user gesture needs this on Firefox
  // (Chrome grants it implicitly to extension pages)
  result.permissions = [...manifest.permissions, 'clipboardWrite'];

  return result;
}

module.exports = transformManifest;
