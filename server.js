const express = require('express');
const path = require('path');
const fs = require('fs');
const { validateRange, validateSegments } = require('./lib/time');
const { validateResolution } = require('./lib/config');
const { downloadClip, downloadMultipleSegments, downloadMultipleFullVideos } = require('./lib/download');
const { parseVideoList, validateVideoList } = require('./lib/urls');
const { resolveVideoTitles } = require('./lib/youtube-meta');
const { isChannelUrl, scrapeChannelVideos } = require('./lib/youtube-channel');
const { isPlaylistUrl, scrapePlaylistVideos } = require('./lib/youtube-playlist');
const { createZip } = require('./lib/zip');
const { createJob, getJob, getCompletedFiles, snapshotJob, touchJob, removeJob } = require('./lib/jobs');

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

function sendFileDownload(res, filePath, filename, onDone) {
  const safeAscii = filename.replace(/[^\x20-\x7E]/g, '_');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${safeAscii.replace(/"/g, '\\"')}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
  );
  res.sendFile(path.resolve(filePath), (err) => onDone(err));
}

app.post('/api/download', async (req, res) => {
  const { url, startTime, endTime, resolution = 'best', fastMode = false } = req.body;

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
      Boolean(fastMode),
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
  const { url, segments, resolution = 'best', fastMode = false } = req.body;

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
    const files = await downloadMultipleSegments(url, validatedSegments, jobDir, validatedResolution, Boolean(fastMode));

    if (files.length === 1) {
      return sendFileDownload(res, files[0].path, files[0].name, (err) => {
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

app.post('/api/resolve-titles', async (req, res) => {
  const { items, text } = req.body;

  try {
    let parsedItems;
    if (Array.isArray(items) && items.length > 0) {
      parsedItems = validateVideoList(items);
    } else if (text && typeof text === 'string') {
      parsedItems = validateVideoList(parseVideoList(text));
    } else {
      throw new Error('Cần danh sách video hoặc nội dung text');
    }

    const resolved = await resolveVideoTitles(parsedItems);
    res.json({
      items: resolved,
      count: resolved.length,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/scrape-channel', async (req, res) => {
  const { url, maxVideos = 0 } = req.body;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Vui lòng nhập link kênh YouTube' });
  }

  if (!isChannelUrl(url)) {
    return res.status(400).json({ error: 'Link không phải kênh YouTube hợp lệ' });
  }

  const limit = Number(maxVideos);
  const parsedLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 0;

  try {
    const result = await scrapeChannelVideos(url, { maxVideos: parsedLimit });

    if (!result.items.length) {
      return res.status(404).json({ error: 'Không tìm thấy video nào trên kênh này' });
    }

    res.json({
      channelName: result.channelName,
      items: result.items,
      count: result.items.length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Cào kênh thất bại' });
  }
});

app.post('/api/scrape-playlist', async (req, res) => {
  const { url, maxVideos = 0 } = req.body;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Vui lòng nhập link playlist YouTube' });
  }

  if (!isPlaylistUrl(url)) {
    return res.status(400).json({ error: 'Link không phải playlist YouTube hợp lệ' });
  }

  const limit = Number(maxVideos);
  const parsedLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 0;

  try {
    const result = await scrapePlaylistVideos(url, { maxVideos: parsedLimit });

    if (!result.items.length) {
      return res.status(404).json({ error: 'Không tìm thấy video nào trong playlist này' });
    }

    res.json({
      playlistName: result.playlistName,
      items: result.items,
      count: result.items.length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Cào playlist thất bại' });
  }
});

app.post('/api/parse-urls', (req, res) => {
  const { text } = req.body;
  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'Thiếu nội dung text' });
  }

  try {
    const items = parseVideoList(text);
    res.json({
      items,
      count: items.length,
      namedCount: items.filter((item) => item.name).length,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

function parseFullBatchItems(body) {
  const { items, urls, text } = body;

  if (Array.isArray(items) && items.length > 0) {
    return validateVideoList(items);
  }
  if (Array.isArray(urls) && urls.length > 0) {
    return validateVideoList(urls.map((url) => ({ url })));
  }
  if (text && typeof text === 'string') {
    return validateVideoList(parseVideoList(text));
  }
  throw new Error('Cần danh sách video hoặc nội dung file text');
}

function buildDownloadHooks(job) {
  return {
    continueOnError: true,
    onItemStart: (index) => {
      job.items[index].status = 'downloading';
      job.items[index].error = null;
      touchJob(job);
    },
    onItemMeta: (index, displayName) => {
      job.items[index].displayName = displayName;
      touchJob(job);
    },
    onItemComplete: (index, file) => {
      const item = job.items[index];
      if (item.status === 'done') return;

      if (item.status === 'error') {
        job.failed = Math.max(0, job.failed - 1);
      }

      item.status = 'done';
      item.filename = file.name;
      item.filePath = file.path;
      item.error = null;
      job.completed += 1;
      touchJob(job);
    },
    onItemError: (index, err) => {
      const message = err.stderr || err.message || 'Tải video thất bại';
      job.items[index].status = 'error';
      job.items[index].error = String(message).slice(0, 300);
      job.failed += 1;
      touchJob(job);
    },
  };
}

async function finalizeJobZip(job) {
  const files = getCompletedFiles(job);
  if (!files.length) {
    job.status = 'error';
    job.error = 'Không tải được video nào';
    touchJob(job);
    return;
  }

  job.status = 'zipping';
  touchJob(job);

  try {
    if (files.length === 1) {
      job.resultPath = files[0].path;
      job.resultName = files[0].name;
    } else {
      const zipPath = path.join(job.jobDir, 'videos.zip');
      await createZip(files, zipPath);
      job.resultPath = zipPath;
      job.resultName = 'videos.zip';
    }

    job.status = 'done';
    job.error = null;
    touchJob(job);
  } catch (err) {
    job.status = 'partial';
    job.error = err.message || 'Nén ZIP thất bại, vẫn có thể tải từng video';
    touchJob(job);
  }
}

async function runFullBatchJob(job, validatedItems, resolution, fastMode, itemIndices = null) {
  const targetIndices = itemIndices || validatedItems.map((_, index) => index);
  const itemsToDownload = targetIndices.map((index) => validatedItems[index]);
  const baseHooks = buildDownloadHooks(job);

  job.status = 'running';
  touchJob(job);

  try {
    await downloadMultipleFullVideos(
      itemsToDownload,
      job.jobDir,
      resolution,
      fastMode,
      {
        continueOnError: true,
        onItemStart: (i) => baseHooks.onItemStart(targetIndices[i]),
        onItemMeta: (i, displayName) => baseHooks.onItemMeta(targetIndices[i], displayName),
        onItemComplete: (i, file) => baseHooks.onItemComplete(targetIndices[i], file),
        onItemError: (i, err) => baseHooks.onItemError(targetIndices[i], err),
      },
    );

    await finalizeJobZip(job);
  } catch (err) {
    if (job.completed > 0) {
      job.status = 'partial';
      job.error = err.stderr || err.message || 'Tải video thất bại';
    } else {
      job.status = 'error';
      job.error = err.stderr || err.message || 'Tải video thất bại';
    }
    touchJob(job);
  }
}

function parseDownloadIndices(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const indices = raw
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((value) => Number.isInteger(value) && value >= 0);
  return indices.length ? indices : null;
}

async function prepareJobDownload(job, indices = null) {
  const selectedIndices = indices && indices.length ? indices : null;

  if (!selectedIndices && job.status === 'done' && job.resultPath && fs.existsSync(job.resultPath)) {
    return {
      filePath: job.resultPath,
      filename: job.resultName,
      tempPath: null,
    };
  }

  const files = getCompletedFiles(job, selectedIndices);
  if (!files.length) {
    throw new Error('Không có video nào để tải');
  }

  for (const file of files) {
    if (!fs.existsSync(file.path)) {
      throw new Error(`File không tồn tại: ${file.name}`);
    }
  }

  if (files.length === 1) {
    return {
      filePath: files[0].path,
      filename: files[0].name,
      tempPath: null,
    };
  }

  const zipPath = path.join(job.jobDir, `selected-${Date.now()}.zip`);
  await createZip(files, zipPath);
  return {
    filePath: zipPath,
    filename: 'videos.zip',
    tempPath: zipPath,
  };
}

app.post('/api/download-full-batch/start', (req, res) => {
  const { resolution = 'best', fastMode = false } = req.body;

  let validatedItems;
  let validatedResolution;
  try {
    validatedItems = parseFullBatchItems(req.body);
    validatedResolution = validateResolution(resolution);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const jobId = String(Date.now());
  const jobDir = path.join(DOWNLOAD_DIR, jobId);
  fs.mkdirSync(jobDir, { recursive: true });

  const job = createJob(jobId, validatedItems, jobDir, {
    resolution: validatedResolution,
    fastMode: Boolean(fastMode),
  });
  res.json({ jobId });

  runFullBatchJob(job, validatedItems, validatedResolution, Boolean(fastMode));
});

app.get('/api/jobs/:jobId', (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Không tìm thấy job' });
  }
  res.json(snapshotJob(job));
});

app.get('/api/jobs/:jobId/download', async (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Không tìm thấy job' });
  }

  const indices = parseDownloadIndices(req.query.indices);
  const cleanup = req.query.cleanup === '1';

  try {
    const prepared = await prepareJobDownload(job, indices);
    sendFileDownload(res, prepared.filePath, prepared.filename, (err) => {
      if (prepared.tempPath && fs.existsSync(prepared.tempPath)) {
        fs.unlinkSync(prepared.tempPath);
      }
      if (cleanup) {
        cleanupJob(job.jobDir);
        removeJob(job.id);
      }
      if (err && !res.headersSent) {
        res.status(500).json({ error: 'Lỗi khi gửi file về máy' });
      }
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/jobs/:jobId/resume', (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Không tìm thấy job' });
  }
  if (job.status === 'running' || job.status === 'zipping') {
    return res.status(400).json({ error: 'Job đang chạy' });
  }

  const pendingIndices = job.items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.status !== 'done')
    .map(({ index }) => index);

  if (!pendingIndices.length) {
    return res.status(400).json({ error: 'Không còn video nào cần tải' });
  }

  const validatedItems = job.items.map((item) => ({
    url: item.url,
    name: item.name || undefined,
  }));

  job.resultPath = null;
  job.resultName = null;
  job.error = null;
  res.json({ jobId: job.id, pendingCount: pendingIndices.length });

  runFullBatchJob(
    job,
    validatedItems,
    job.resolution,
    job.fastMode,
    pendingIndices,
  );
});

app.delete('/api/jobs/:jobId', (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Không tìm thấy job' });
  }

  cleanupJob(job.jobDir);
  removeJob(job.id);
  res.json({ ok: true });
});

app.post('/api/download-full-batch', async (req, res) => {
  const { resolution = 'best', fastMode = false } = req.body;

  let validatedItems;
  let validatedResolution;
  try {
    validatedItems = parseFullBatchItems(req.body);
    validatedResolution = validateResolution(resolution);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const jobId = Date.now();
  const jobDir = path.join(DOWNLOAD_DIR, String(jobId));
  fs.mkdirSync(jobDir, { recursive: true });

  try {
    const files = await downloadMultipleFullVideos(
      validatedItems,
      jobDir,
      validatedResolution,
      Boolean(fastMode),
    );

    if (files.length === 1) {
      return sendFileDownload(res, files[0].path, files[0].name, (err) => {
        cleanupJob(jobDir);
        if (err && !res.headersSent) {
          res.status(500).json({ error: 'Lỗi khi gửi file về máy' });
        }
      });
    }

    const zipPath = path.join(jobDir, 'videos.zip');
    await createZip(files, zipPath);

    res.download(zipPath, 'videos.zip', (err) => {
      cleanupJob(jobDir);
      if (err && !res.headersSent) {
        res.status(500).json({ error: 'Lỗi khi gửi file về máy' });
      }
    });
  } catch (err) {
    cleanupJob(jobDir);
    const videoInfo = err.chunkIndex != null ? ` (video ${err.chunkIndex + 1})` : '';
    const message = err.stderr || err.message || 'Tải video thất bại';
    res.status(500).json({ error: String(message).slice(0, 500) + videoInfo });
  }
});

app.listen(PORT, () => {
  console.log(`http://localhost:${PORT}`);
});
