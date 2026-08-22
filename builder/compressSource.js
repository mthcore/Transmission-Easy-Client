require('./defaultBuildEnv');
const path = require('path');
const zipDirectory = require('./zipDirectory');

const compressSource = () => {
  const ext = 'zip';
  const outputPath = BUILD_ENV.outputPath;

  return zipDirectory({
    dirs: [
      {from: path.join(__dirname, '../builder'), to: 'builder'},
      {from: path.join(__dirname, '../src'), to: 'src'},
    ],
    // Everything `npm run release` touches must be here, or an AMO reviewer
    // following the README cannot rebuild the bundle: type-check runs tsc,
    // which needs tsconfig.json, and lint/test need their configs too.
    files: [
      {from: path.join(__dirname, '../package.json'), to: 'package.json'},
      {from: path.join(__dirname, '../package-lock.json'), to: 'package-lock.json'},
      {from: path.join(__dirname, '../README.md'), to: 'README.md'},
      {from: path.join(__dirname, '../webpack.config.js'), to: 'webpack.config.js'},
      {from: path.join(__dirname, '../tsconfig.json'), to: 'tsconfig.json'},
      {from: path.join(__dirname, '../vitest.config.ts'), to: 'vitest.config.ts'},
      {from: path.join(__dirname, '../eslint.config.js'), to: 'eslint.config.js'},
      {from: path.join(__dirname, '../.prettierrc'), to: '.prettierrc'},
      {from: path.join(__dirname, '../LICENSE'), to: 'LICENSE'},
    ]
  }, path.join(outputPath, `${BUILD_ENV.distName}-source.${ext}`));
};

// Fail the build on a packaging error: a truncated source archive is worse
// than none at all, since AMO would reject the submission on it
compressSource().catch((err) => {
  console.error('compressSource failed:', err);
  process.exit(1);
});