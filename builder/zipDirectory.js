const fs = require('fs');
// archiver v8 replaced the archiver('zip', opts) factory with named classes
const { ZipArchive } = require('archiver');

const _zipDirectory = ({files = [], dirs = []}, zipFilePath, callback) => {
  const output = fs.createWriteStream(zipFilePath);
  const zipArchive = new ZipArchive({
    zlib: { level: 9 }
  });

  output.on('close', function() {
    callback();
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

  Promise.resolve(zipArchive.finalize()).catch(callback);
};

const zipDirectory = ({files, dirs}, zipFilePath) => {
  return new Promise((resolve, reject) => {
    _zipDirectory({files, dirs}, zipFilePath, (err) => {
      err ? reject(err) : resolve();
    });
  });
};

module.exports = zipDirectory;