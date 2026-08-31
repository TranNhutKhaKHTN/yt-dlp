const CHUNK_THRESHOLD_SEC = 60;
const CONCURRENT_FRAGMENTS = 16;
const MAX_PARALLEL_SEGMENTS = 4;

const RESOLUTIONS = [
  { value: 'best', label: 'Cao nhất (1080p+)' },
  { value: '1080', label: '1080p' },
  { value: '720', label: '720p' },
  { value: '480', label: '480p' },
  { value: '360', label: '360p' },
];

function getFormat(resolution = 'best') {
  const heightFilter = resolution === 'best' ? '' : `[height<=${resolution}]`;
  return `bestvideo[vcodec^=avc1]${heightFilter}+bestaudio[acodec^=mp4a]/bestvideo[vcodec^=avc1]${heightFilter}+bestaudio/best`;
}

function validateResolution(resolution) {
  const valid = RESOLUTIONS.some((r) => r.value === resolution);
  if (!valid) {
    throw new Error('Độ phân giải không hợp lệ');
  }
  return resolution;
}

function getDownloadStrategy(durationSec) {
  if (durationSec <= CHUNK_THRESHOLD_SEC) {
    return {
      useChunks: false,
      chunkSizeSec: null,
      maxParallel: 1,
      concurrentFragments: CONCURRENT_FRAGMENTS,
    };
  }

  if (durationSec <= 180) {
    return {
      useChunks: true,
      chunkSizeSec: 60,
      maxParallel: 4,
      concurrentFragments: CONCURRENT_FRAGMENTS,
    };
  }

  return {
    useChunks: true,
    chunkSizeSec: 45,
    maxParallel: 6,
    concurrentFragments: CONCURRENT_FRAGMENTS,
  };
}

module.exports = {
  CHUNK_THRESHOLD_SEC,
  CONCURRENT_FRAGMENTS,
  MAX_PARALLEL_SEGMENTS,
  RESOLUTIONS,
  getFormat,
  validateResolution,
  getDownloadStrategy,
};
