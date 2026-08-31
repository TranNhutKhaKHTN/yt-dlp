const express = require('express');
const path = require('path');
const fs = require('fs');
const { validateRange, validateSegments } = require('./lib/time');
const { validateResolution } = require('./lib/config');
const { downloadClip, downloadMultipleSegments } = require('./lib/download');
const { createZip } = require('./lib/zip');

const app = express();
const PORT = 3000;
const DOWNLOAD_DIR = path.join(__dirname, 'downloads');

if (!fs.existsSync(DOWNLOAD_DIR)) {
  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function cleanupJob(jobDir) {
  fs.rm(jobDir, { recursive: true, force: true }, () => {});
}

app.post('/api/download', async (req, res) => {
  const { url, startTime, endTime, resolution = 'best' } = req.body;

  if (!url || !startTime || !endTime) {
    return res.status(400).json({ error: 'Vui lòng nhập đầy đủ link và thời gian' });
  }

  let range;
  let validatedResolution;
  try {
    range = validateRange(startTime, endTime);
    validatedResolution = validateResolution(resolution);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const jobId = Date.now();
  const jobDir = path.join(DOWNLOAD_DIR, String(jobId));
  fs.mkdirSync(jobDir, { recursive: true });

  try {
    const filePath = await downloadClip(
      url,
      range.start,
      range.end,
      range.startSec,
      range.endSec,
      jobDir,
      null,
      validatedResolution,
    );

    const videoFile = path.basename(filePath);
    res.download(filePath, videoFile, (err) => {
      cleanupJob(jobDir);
      if (err && !res.headersSent) {
        res.status(500).json({ error: 'Lỗi khi gửi file về máy' });
      }
    });
  } catch (err) {
    cleanupJob(jobDir);
    const chunkInfo = err.chunkIndex != null ? ` (chunk ${err.chunkIndex})` : '';
    const message = err.stderr || err.message || 'Tải video thất bại';
    res.status(500).json({ error: String(message).slice(0, 500) + chunkInfo });
  }
});

app.post('/api/download-batch', async (req, res) => {
  const { url, segments, resolution = 'best' } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'Vui lòng nhập link video' });
  }

  let validatedSegments;
  let validatedResolution;
  try {
    validatedSegments = validateSegments(segments);
    validatedResolution = validateResolution(resolution);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const jobId = Date.now();
  const jobDir = path.join(DOWNLOAD_DIR, String(jobId));
  fs.mkdirSync(jobDir, { recursive: true });

  try {
    const files = await downloadMultipleSegments(url, validatedSegments, jobDir, validatedResolution);

    if (files.length === 1) {
      return res.download(files[0].path, files[0].name, (err) => {
        cleanupJob(jobDir);
        if (err && !res.headersSent) {
          res.status(500).json({ error: 'Lỗi khi gửi file về máy' });
        }
      });
    }

    const zipPath = path.join(jobDir, 'clips.zip');
    await createZip(files, zipPath);

    res.download(zipPath, 'clips.zip', (err) => {
      cleanupJob(jobDir);
      if (err && !res.headersSent) {
        res.status(500).json({ error: 'Lỗi khi gửi file về máy' });
      }
    });
  } catch (err) {
    cleanupJob(jobDir);
    const chunkInfo = err.chunkIndex != null ? ` (phân đoạn ${err.chunkIndex + 1})` : '';
    const message = err.stderr || err.message || 'Tải video thất bại';
    res.status(500).json({ error: String(message).slice(0, 500) + chunkInfo });
  }
});

app.listen(PORT, () => {
  console.log(`http://localhost:${PORT}`);
});
