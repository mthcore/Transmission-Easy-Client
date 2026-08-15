const getArgvValue = require('./getArgvValue');
const path = require('path');

const mode = getArgvValue('--mode') || 'development';

const version = require('../src/manifest').version;

const browser = process.env.BROWSER || getArgvValue('--BROWSER') || 'chrome';

const targets = browser === 'firefox' ? { firefox: '109' } : { chrome: '88' };
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
