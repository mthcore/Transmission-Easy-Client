require('./defaultBuildEnv');
const path = require('path');
const zipDirectory = require('./zipDirectory');

const compressDist = () => {
  const ext = 'zip';
  const outputPath = BUILD_ENV.outputPath;

  return zipDirectory({
    dirs: [
      path.join(BUILD_ENV.outputPath, './src')
    ]
  }, path.join(outputPath, `${BUILD_ENV.distName}.${ext}`));
};

// Fail the build on a packaging error instead of leaving a truncated archive
// behind and letting `npm run release` continue to the next browser
compressDist().catch((err) => {
  console.error('compressDist failed:', err);
  process.exit(1);
});