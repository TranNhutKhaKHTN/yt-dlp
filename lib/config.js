const CHUNK_THRESHOLD_SEC = 60;
const CONCURRENT_FRAGMENTS = 16;
const CONCURRENT_FRAGMENTS_FAST = 32;
const MAX_PARALLEL_SEGMENTS = 4;
const FAST_MODE_MAX_HEIGHT = 480;

const RESOLUTIONS = [
  { value: 'best', label: 'Cao nhất (1080p+)' },
  { value: '1080', label: '1080p' },
  { value: '720', label: '720p' },
  { value: '480', label: '480p' },
  { value: '360', label: '360p' },
];

function getEffectiveResolution(resolution, fastMode) {
  if (!fastMode) return resolution;

  if (resolution === 'best' || resolution === '1080' || resolution === '720') {
    return String(FAST_MODE_MAX_HEIGHT);
  }
  return resolution;
}

function getFormat(resolution = 'best', fastMode = false) {
  const effective = getEffectiveResolution(resolution, fastMode);
  const heightFilter = effective === 'best' ? '' : `[height<=${effective}]`;

  if (fastMode && effective !== 'best') {
    return `best[ext=mp4][vcodec^=avc1]${heightFilter}[acodec!=none]/bestvideo[vcodec^=avc1]${heightFilter}+bestaudio[acodec^=mp4a]/bestvideo[vcodec^=avc1]${heightFilter}+bestaudio/best`;
  }

  return `bestvideo[vcodec^=avc1]${heightFilter}+bestaudio[acodec^=mp4a]/bestvideo[vcodec^=avc1]${heightFilter}+bestaudio/best`;
}

function validateResolution(resolution) {
  const valid = RESOLUTIONS.some((r) => r.value === resolution);
  if (!valid) {
    throw new Error('Độ phân giải không hợp lệ');
  }
  return resolution;
}

function getDownloadStrategy(durationSec, fastMode = false) {
  const concurrentFragments = fastMode ? CONCURRENT_FRAGMENTS_FAST : CONCURRENT_FRAGMENTS;
  const threshold = fastMode ? 90 : CHUNK_THRESHOLD_SEC;

  if (durationSec <= threshold) {
    return {
      useChunks: false,
      chunkSizeSec: null,
      maxParallel: 1,
      concurrentFragments,
    };
  }

  if (durationSec <= 180) {
    return {
      useChunks: true,
      chunkSizeSec: fastMode ? 45 : 60,
      maxParallel: 4,
      concurrentFragments,
    };
  }

  return {
    useChunks: true,
    chunkSizeSec: fastMode ? 30 : 45,
    maxParallel: 6,
    concurrentFragments,
  };
}

module.exports = {
  CHUNK_THRESHOLD_SEC,
  CONCURRENT_FRAGMENTS,
  MAX_PARALLEL_SEGMENTS,
  RESOLUTIONS,
  getFormat,
  getEffectiveResolution,
  validateResolution,
  getDownloadStrategy,
};
