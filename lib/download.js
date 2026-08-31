const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { create: createYoutubeDl } = require('youtube-dl-exec');
const ffmpegPath = require('ffmpeg-static');
const { splitRange } = require('./chunk');
const { getFormat, getDownloadStrategy, CHUNK_THRESHOLD_SEC, CONCURRENT_FRAGMENTS, MAX_PARALLEL_SEGMENTS } = require('./config');
const { sanitizeFilename } = require('./time');

const execFileAsync = promisify(execFile);

const binName = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
const youtubedl = createYoutubeDl(path.join(__dirname, '..', 'bin', binName));

function baseOptions(strategy, infoPath, resolution) {
  const opts = {
    noPlaylist: true,
    mergeOutputFormat: 'mp4',
    format: getFormat(resolution),
    noCheckCertificates: true,
    ffmpegLocation: ffmpegPath,
    concurrentFragments: strategy.concurrentFragments,
    bufferSize: '64K',
    httpChunkSize: '10M',
  };

  if (infoPath) {
    opts.loadInfoJson = infoPath;
  }

  return opts;
}

async function fetchVideoInfo(url, jobDir) {
  const infoPath = path.join(jobDir, 'info.json');
  const info = await youtubedl(url, {
    dumpSingleJson: true,
    noPlaylist: true,
    noCheckCertificates: true,
  });
  fs.writeFileSync(infoPath, JSON.stringify(info));
  return infoPath;
}

async function downloadSection(url, start, end, outputTemplate, strategy, infoPath, resolution) {
  await youtubedl(url, {
    ...baseOptions(strategy, infoPath, resolution),
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

async function runPool(items, worker, maxParallel) {
  const results = new Array(items.length);
  let index = 0;

  async function runNext() {
    while (index < items.length) {
      const i = index++;
      try {
        results[i] = await worker(items[i], i);
      } catch (err) {
        err.chunkIndex = i;
        throw err;
      }
    }
  }

  const runners = Array.from({ length: Math.min(maxParallel, items.length) }, runNext);
  await Promise.all(runners);
  return results;
}

async function downloadParallelChunks(url, startSec, endSec, jobDir, strategy, infoPath = null, resolution = 'best') {
  const resolvedInfoPath = infoPath || await fetchVideoInfo(url, jobDir);
  const chunks = splitRange(startSec, endSec, strategy.chunkSizeSec);

  const partPaths = await runPool(
    chunks,
    async (chunk, i) => {
      const outputTemplate = path.join(jobDir, `part-${i}.%(ext)s`);
      return downloadSection(url, chunk.start, chunk.end, outputTemplate, strategy, resolvedInfoPath, resolution);
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

async function downloadClip(url, start, end, startSec, endSec, jobDir, infoPath = null, resolution = 'best') {
  const durationSec = endSec - startSec;
  const strategy = getDownloadStrategy(durationSec);

  if (strategy.useChunks) {
    return downloadParallelChunks(url, startSec, endSec, jobDir, strategy, infoPath, resolution);
  }

  const outputTemplate = path.join(jobDir, 'clip.%(ext)s');
  return downloadSection(url, start, end, outputTemplate, strategy, infoPath, resolution);
}

async function downloadMultipleSegments(url, segments, jobDir, resolution = 'best') {
  const infoPath = await fetchVideoInfo(url, jobDir);

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
      );

      const name = `clip_${seg.index + 1}_${sanitizeFilename(seg.start)}_${sanitizeFilename(seg.end)}.mp4`;
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
  downloadMultipleSegments,
  fetchVideoInfo,
  getDownloadStrategy,
  CONCURRENT_FRAGMENTS,
  CHUNK_THRESHOLD_SEC,
};
