/**
 * Fails when package.json and src/manifest.json disagree on the version, or when
 * the Babel browser targets no longer match the real floors.
 *
 * Two invariants, both of which have actually broken:
 *
 * 1. The stores read the version from the MANIFEST, not from the git tag, and
 *    release.yml already rejects a tag that disagrees with it — but only after
 *    the tag exists, i.e. after the release has been tagged and announced. This
 *    catches it on the pull request instead.
 *
 * 2. builder/defaultBuildEnv.js claims its Babel targets are "kept in sync with
 *    the real floors". They drifted: the manifest moved to Chrome 111 (the
 *    floor for chrome.scripting world:'MAIN', used by the download-button
 *    capture) while the Babel target stayed at 101. Harmless to output — Babel
 *    was merely over-conservative — but the asserted invariant was false, and
 *    it lives in a directory with no lint and no tests.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function main() {
  const errors = [];

  const pkg = JSON.parse(read('package.json'));
  const manifest = JSON.parse(read('src/manifest.json'));

  if (pkg.version !== manifest.version) {
    errors.push(
      `version mismatch: package.json ${pkg.version} vs src/manifest.json ${manifest.version}`
    );
  }

  // Read the targets textually: defaultBuildEnv.js assigns a global and reads
  // process.env, so requiring it here would have side effects.
  const buildEnv = read('builder/defaultBuildEnv.js');
  const chromeTarget = /\{\s*chrome:\s*'(\d+)'\s*\}/.exec(buildEnv);
  const firefoxTarget = /\{\s*firefox:\s*'(\d+)'\s*\}/.exec(buildEnv);

  if (!chromeTarget || !firefoxTarget) {
    errors.push('could not read the Babel targets from builder/defaultBuildEnv.js');
  } else {
    const manifestChrome = String(manifest.minimum_chrome_version ?? '');
    if (chromeTarget[1] !== manifestChrome) {
      errors.push(
        `Babel chrome target ${chromeTarget[1]} != manifest minimum_chrome_version ${manifestChrome}`
      );
    }

    // The Firefox floor is written into the manifest at build time rather than
    // stored in src/manifest.json, so it is read from the transform that emits
    // it. (It used to live inline in webpack.config.js; this check broke when
    // the transform was extracted, which is exactly what it is here to notice.)
    const transform = read('builder/transformManifest.js');
    const gecko = /strict_min_version:\s*'(\d+)(?:\.\d+)?'/.exec(transform);
    if (!gecko) {
      errors.push('could not read gecko.strict_min_version from builder/transformManifest.js');
    } else if (firefoxTarget[1] !== gecko[1]) {
      errors.push(
        `Babel firefox target ${firefoxTarget[1]} != gecko.strict_min_version ${gecko[1]}`
      );
    }
  }

  if (errors.length) {
    for (const error of errors) console.error(`::error::${error}`);
    return 1;
  }
  console.log(
    `Versions OK: ${pkg.version}; targets chrome ${chromeTarget[1]}, firefox ${firefoxTarget[1]}.`
  );
  return 0;
}

process.exit(main());
