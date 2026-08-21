const getArgvValue = require('./getArgvValue');
const path = require('path');

const mode = getArgvValue('--mode') || 'development';

const version = require('../src/manifest').version;

const browser = process.env.BROWSER || getArgvValue('--BROWSER') || 'chrome';

// Kept in sync with the real floors: src/manifest.json's minimum_chrome_version
// and the gecko.strict_min_version webpack.config.js writes into the Firefox manifest.
const targets = browser === 'firefox' ? { firefox: '127' } : { chrome: '101' };
const babelEnvOptions = { targets };

global.BUILD_ENV = {
  distName: `transmissionEasyClient-${browser}-${version}`,
  outputPath: path.join(__dirname, `../dist/${browser}`),
  mode,
  devtool: mode === 'development' ? 'inline-source-map' : false,
  version,
  browser,
  babelEnvOptions,
  FLAG_ENABLE_LOGGER: mode !== 'production',
};
