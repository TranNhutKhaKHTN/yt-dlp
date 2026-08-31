const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const binDir = path.join(__dirname, '..', 'bin');
const platform = process.platform;
const urls = {
  darwin: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos',
  linux: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp',
  win32: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe',
};

const url = urls[platform];
if (!url) {
  console.log('Unsupported platform, skip yt-dlp download');
  process.exit(0);
}

const filename = platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
const target = path.join(binDir, filename);

if (fs.existsSync(target)) {
  process.exit(0);
}

fs.mkdirSync(binDir, { recursive: true });
execSync(`curl -L -o "${target}" "${url}"`, { stdio: 'inherit' });
if (platform !== 'win32') {
  fs.chmodSync(target, 0o755);
}
