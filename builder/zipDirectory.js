const fs = require('fs');
// archiver v8 replaced the archiver('zip', opts) factory with named classes
const { ZipArchive } = require('archiver');

const _zipDirectory = ({files = [], dirs = []}, zipFilePath, callback) => {
  const output = fs.createWriteStream(zipFilePath);
  const zipArchive = new ZipArchive({
    zlib: { level: 9 }
  });

  let settled = false;
  const done = (err) => {
    if (settled) return;
    settled = true;
    callback(err);
  };

  output.on('close', () => done());
  // archiver reports missing files and permission problems as an 'error' EVENT,
  // not through finalize()'s promise: with no listener Node rethrows it as an
  // uncaught exception and a half-written archive is left on disk.
  output.on('error', done);
  zipArchive.on('error', done);
  zipArchive.on('warning', (err) => {
    // ENOENT on an entry means the archive would be incomplete
    if (err && err.code === 'ENOENT') done(err);
  });

  zipArchive.pipe(output);

  files.forEach((file) => {
    if (typeof file === 'string') {
      zipArchive.file(file);
    } else {
      zipArchive.file(file.from, {name: file.to});
    }
  });

  dirs.forEach((dir) => {
    if (typeof dir === 'string') {
      zipArchive.directory(dir, false);
    } else {
      zipArchive.directory(dir.from, dir.to);
    }
  });

  Promise.resolve(zipArchive.finalize()).catch(done);
};

const zipDirectory = ({files, dirs}, zipFilePath) => {
  return new Promise((resolve, reject) => {
    _zipDirectory({files, dirs}, zipFilePath, (err) => {
      err ? reject(err) : resolve();
    });
  });
};

module.exports = zipDirectory;