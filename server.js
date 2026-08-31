const express = require('express');
const path = require('path');
const fs = require('fs');
const { create: createYoutubeDl } = require('youtube-dl-exec');
const ffmpegPath = require('ffmpeg-static');

const binName = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
const youtubedl = createYoutubeDl(path.join(__dirname, 'bin', binName));

const app = express();
const PORT = 3000;
const DOWNLOAD_DIR = path.join(__dirname, 'downloads');

if (!fs.existsSync(DOWNLOAD_DIR)) {
  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function normalizeTime(value) {
  const trimmed = String(value).trim();
  if (!trimmed) throw new Error('Thời gian không hợp lệ');
  if (/^\d+$/.test(trimmed)) return trimmed;
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(trimmed)) return trimmed;
  throw new Error(`Định dạng thời gian không hợp lệ: ${trimmed}`);
}

app.post('/api/download', async (req, res) => {
  const { url, startTime, endTime } = req.body;

  if (!url || !startTime || !endTime) {
    return res.status(400).json({ error: 'Vui lòng nhập đầy đủ link và thời gian' });
  }

  let start;
  let end;
  try {
    start = normalizeTime(startTime);
    end = normalizeTime(endTime);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const jobId = Date.now();
  const jobDir = path.join(DOWNLOAD_DIR, String(jobId));
  fs.mkdirSync(jobDir, { recursive: true });

  const section = `*${start}-${end}`;
  const outputTemplate = path.join(jobDir, 'clip.%(ext)s');

  try {
    await youtubedl(url, {
      downloadSections: section,
      output: outputTemplate,
      noPlaylist: true,
      mergeOutputFormat: 'mp4',
      format: 'bestvideo[vcodec^=avc1]+bestaudio[acodec^=mp4a]/bestvideo[vcodec^=avc1]+bestaudio/best',
      noCheckCertificates: true,
      ffmpegLocation: ffmpegPath,
    });

    const files = fs.readdirSync(jobDir).filter((f) => !f.endsWith('.part'));
    const videoFile = files.find((f) => f.startsWith('clip.'));

    if (!videoFile) {
      throw new Error('Không tìm thấy file video sau khi tải');
    }

    const filePath = path.join(jobDir, videoFile);
    res.download(filePath, videoFile, (err) => {
      fs.rm(jobDir, { recursive: true, force: true }, () => {});
      if (err && !res.headersSent) {
        res.status(500).json({ error: 'Lỗi khi gửi file về máy' });
      }
    });
  } catch (err) {
    fs.rm(jobDir, { recursive: true, force: true }, () => {});
    const message = err.stderr || err.message || 'Tải video thất bại';
    res.status(500).json({ error: String(message).slice(0, 500) });
  }
});

app.listen(PORT, () => {
  console.log(`http://localhost:${PORT}`);
});
