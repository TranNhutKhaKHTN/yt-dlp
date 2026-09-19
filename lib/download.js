const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { create: createYoutubeDl } = require('youtube-dl-exec');
const ffmpegPath = require('ffmpeg-static');
const { splitRange } = require('./chunk');
const {
  getFormat,
  getDownloadStrategy,
  CHUNK_THRESHOLD_SEC,
  CONCURRENT_FRAGMENTS,
  MAX_PARALLEL_SEGMENTS,
  MAX_PARALLEL_FULL_VIDEOS,
} = require('./config');
const { sanitizeFilename, sanitizeVideoTitle, buildVideoFilename, buildNumberedVideoTitle } = require('./time');
const { getVideoTitle } = require('./youtube-meta');

const execFileAsync = promisify(execFile);

const binName = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
const youtubedl = createYoutubeDl(path.join(__dirname, '..', 'bin', binName));

function baseOptions(strategy, infoPath, resolution, fastMode) {
  const opts = {
    noPlaylist: true,
    mergeOutputFormat: 'mp4',
    format: getFormat(resolution, fastMode),
    noCheckCertificates: true,
    ffmpegLocation: ffmpegPath,
    concurrentFragments: strategy.concurrentFragments,
    bufferSize: '128K',
    httpChunkSize: '10M',
    noWriteSubs: true,
    noWriteThumbnail: true,
    retries: fastMode ? 3 : 10,
    fragmentRetries: fastMode ? 3 : 10,
  };

  if (fastMode) {
    opts.extractorArgs = 'youtube:player_client=android,web';
  }

  if (infoPath) {
    opts.loadInfoJson = infoPath;
  }

  opts.restrictFilenames = false;

  return opts;
}

async function fetchVideoInfo(url, jobDir, fastMode = false) {
  const infoPath = path.join(jobDir, 'info.json');
  const opts = {
    dumpSingleJson: true,
    noPlaylist: true,
    noCheckCertificates: true,
  };
  if (fastMode) {
    opts.extractorArgs = 'youtube:player_client=android,web';
  }
  const info = await youtubedl(url, opts);
  fs.writeFileSync(infoPath, JSON.stringify(info));
  return infoPath;
}

async function downloadSection(url, start, end, outputTemplate, strategy, infoPath, resolution, fastMode) {
  await youtubedl(url, {
    ...baseOptions(strategy, infoPath, resolution, fastMode),
    downloadSections: `*${start}-${end}`,
    output: outputTemplate,
  });

  const dir = path.dirname(outputTemplate);
  const prefix = path.basename(outputTemplate).replace('.%(ext)s', '.');
  const files = fs.readdirSync(dir).filter((f) => !f.endsWith('.part'));
  const videoFile = files.find((f) => f.startsWith(prefix));

  if (!videoFile) {
    throw new Error('Không tìm thấy file video sau khi tải');
  }

  return path.join(dir, videoFile);
}

async function runPool(items, worker, maxParallel, options = {}) {
  const { failFast = true, onStart, onComplete, onError } = options;
  const results = new Array(items.length);
  let index = 0;

  async function runNext() {
    while (index < items.length) {
      const i = index++;
      try {
        onStart?.(i);
        results[i] = await worker(items[i], i);
        onComplete?.(i, results[i]);
      } catch (err) {
        onError?.(i, err);
        if (failFast) {
          err.chunkIndex = i;
          throw err;
        }
      }
    }
  }

  const runners = Array.from({ length: Math.min(maxParallel, items.length) }, runNext);
  await Promise.all(runners);
  return results.filter(Boolean);
}

async function downloadParallelChunks(url, startSec, endSec, jobDir, strategy, infoPath = null, resolution = 'best', fastMode = false) {
  const resolvedInfoPath = infoPath || await fetchVideoInfo(url, jobDir);
  const chunks = splitRange(startSec, endSec, strategy.chunkSizeSec);

  const partPaths = await runPool(
    chunks,
    async (chunk, i) => {
      const outputTemplate = path.join(jobDir, `part-${i}.%(ext)s`);
      return downloadSection(url, chunk.start, chunk.end, outputTemplate, strategy, resolvedInfoPath, resolution, fastMode);
    },
    strategy.maxParallel,
  );

  const outputPath = path.join(jobDir, 'clip.mp4');
  await mergeParts(partPaths, outputPath);
  return outputPath;
}

async function mergeParts(partPaths, outputPath) {
  const listPath = path.join(path.dirname(outputPath), 'concat.txt');
  const listContent = partPaths
    .map((p) => `file '${path.resolve(p).replace(/'/g, "'\\''")}'`)
    .join('\n');
  fs.writeFileSync(listPath, listContent);

  await execFileAsync(ffmpegPath, [
    '-f', 'concat',
    '-safe', '0',
    '-i', path.resolve(listPath),
    '-c', 'copy',
    '-y',
    path.resolve(outputPath),
  ]);

  fs.unlinkSync(listPath);
  for (const partPath of partPaths) {
    fs.unlinkSync(partPath);
  }
}

async function downloadClip(url, start, end, startSec, endSec, jobDir, infoPath = null, resolution = 'best', fastMode = false) {
  const durationSec = endSec - startSec;
  const strategy = getDownloadStrategy(durationSec, fastMode);

  if (strategy.useChunks) {
    return downloadParallelChunks(url, startSec, endSec, jobDir, strategy, infoPath, resolution, fastMode);
  }

  const outputTemplate = path.join(jobDir, 'clip.%(ext)s');
  return downloadSection(url, start, end, outputTemplate, strategy, infoPath, resolution, fastMode);
}

function findDownloadedFile(dir, prefix) {
  const files = fs.readdirSync(dir).filter((f) => !f.endsWith('.part') && f !== 'info.json');
  if (prefix) {
    const match = files.find((f) => f.startsWith(prefix));
    if (match) return path.join(dir, match);
  }
  const videoFile = files.find((f) => /\.(mp4|webm|mkv|mov)$/i.test(f));
  if (!videoFile) {
    throw new Error('Không tìm thấy file video sau khi tải');
  }
  return path.join(dir, videoFile);
}

function readVideoInfo(infoPath) {
  return JSON.parse(fs.readFileSync(infoPath, 'utf8'));
}

function resolveUniqueFilename(jobDir, title, index, usedNames) {
  let name = buildVideoFilename(title, index);
  if (!usedNames.has(name) && !fs.existsSync(path.join(jobDir, name))) {
    usedNames.add(name);
    return name;
  }

  let attempt = 2;
  while (true) {
    name = buildVideoFilename(`${title} ${attempt}`, index);
    if (!usedNames.has(name) && !fs.existsSync(path.join(jobDir, name))) {
      usedNames.add(name);
      return name;
    }
    attempt += 1;
  }
}

async function downloadFullVideo(url, jobDir, resolution = 'best', fastMode = false, finalBasename = null, infoPath = null) {
  const resolvedInfoPath = infoPath || await fetchVideoInfo(url, jobDir, fastMode);
  const info = readVideoInfo(resolvedInfoPath);
  const videoId = info.id || `video-${Date.now()}`;
  const finalName = finalBasename
    ? `${String(finalBasename).replace(/\.mp4$/i, '')}.mp4`
    : buildVideoFilename(info.title);
  const finalPath = path.join(jobDir, finalName);
  const tempOutput = path.join(jobDir, `${videoId}.%(ext)s`);
  const strategy = getDownloadStrategy(30, fastMode);

  await youtubedl(url, {
    ...baseOptions(strategy, resolvedInfoPath, resolution, fastMode),
    output: tempOutput,
  });

  const downloaded = findDownloadedFile(jobDir, videoId);
  if (fs.existsSync(finalPath)) fs.unlinkSync(finalPath);
  fs.renameSync(downloaded, finalPath);

  return finalPath;
}

async function downloadMultipleFullVideos(items, jobDir, resolution = 'best', fastMode = false, hooks = {}) {
  const usedNames = new Set();
  const { onItemStart, onItemComplete, onItemError, continueOnError = false } = hooks;

  return runPool(
    items,
    async (item, index) => {
      const url = typeof item === 'string' ? item : item.url;
      const customName = item && typeof item === 'object' ? item.name : null;

      const videoDir = path.join(jobDir, `video-${index + 1}`);
      fs.mkdirSync(videoDir, { recursive: true });

      let baseTitle = null;
      try {
        baseTitle = await getVideoTitle(url);
      } catch {
        baseTitle = null;
      }

      const infoPath = await fetchVideoInfo(url, videoDir, fastMode);
      const info = readVideoInfo(infoPath);

      if (!baseTitle) {
        baseTitle = info.title || customName || `video-${index + 1}`;
      }

      const titleForFile = buildNumberedVideoTitle(baseTitle, index, items.length);

      if (hooks.onItemMeta) {
        hooks.onItemMeta(index, titleForFile);
      }

      const destName = resolveUniqueFilename(jobDir, titleForFile, null, usedNames);

      const filePath = await downloadFullVideo(
        url,
        videoDir,
        resolution,
        fastMode,
        destName.replace(/\.mp4$/i, ''),
        infoPath,
      );

      const destPath = path.join(jobDir, destName);
      fs.copyFileSync(filePath, destPath);
      fs.rmSync(videoDir, { recursive: true, force: true });
      return { name: destName, path: destPath, index };
    },
    MAX_PARALLEL_FULL_VIDEOS,
    {
      failFast: !continueOnError,
      onStart: onItemStart,
      onComplete: onItemComplete,
      onError: onItemError,
    },
  );
}

async function downloadMultipleSegments(url, segments, jobDir, resolution = 'best', fastMode = false) {
  const infoPath = await fetchVideoInfo(url, jobDir, fastMode);
  const info = readVideoInfo(infoPath);
  const videoTitle = info.title;
  const usedNames = new Set();

  const files = await runPool(
    segments,
    async (seg) => {
      const segDir = path.join(jobDir, `seg-${seg.index}`);
      fs.mkdirSync(segDir, { recursive: true });

      const filePath = await downloadClip(
        url,
        seg.start,
        seg.end,
        seg.startSec,
        seg.endSec,
        segDir,
        infoPath,
        resolution,
        fastMode,
      );

      const segmentLabel = segments.length === 1
        ? null
        : `${seg.index + 1} ${sanitizeFilename(seg.start)}-${sanitizeFilename(seg.end)}`;
      const name = resolveUniqueFilename(jobDir, videoTitle, segmentLabel, usedNames);
      const destPath = path.join(jobDir, name);
      fs.copyFileSync(filePath, destPath);
      fs.rmSync(segDir, { recursive: true, force: true });
      return { name, path: destPath };
    },
    MAX_PARALLEL_SEGMENTS,
  );

  return files;
}

module.exports = {
  downloadClip,
  downloadFullVideo,
  downloadMultipleFullVideos,
  downloadMultipleSegments,
  fetchVideoInfo,
  getDownloadStrategy,
  CONCURRENT_FRAGMENTS,
  CHUNK_THRESHOLD_SEC,
};
