const { getInnertube } = require('./youtube-meta');
const { extractVideoFromLockup } = require('./youtube-channel');

const PLAYLIST_URL_PATTERN =
  /^https?:\/\/(?:www\.)?youtube\.com\/(?:playlist\?(?:[^\s#]*&)*list=|watch\?(?:[^\s#]*&)*list=)/i;

function extractPlaylistId(url) {
  try {
    const list = new URL(url.trim()).searchParams.get('list');
    if (!list || !/^[\w-]+$/.test(list)) return null;
    return list;
  } catch {
    return null;
  }
}

function isPlaylistUrl(url) {
  if (!url || typeof url !== 'string') return false;
  return PLAYLIST_URL_PATTERN.test(url.trim()) && Boolean(extractPlaylistId(url));
}

function normalizePlaylistUrl(url) {
  const trimmed = url.trim();
  const listId = extractPlaylistId(trimmed);
  if (!listId) {
    throw new Error('Link playlist YouTube không hợp lệ');
  }
  return `https://www.youtube.com/playlist?list=${listId}`;
}

async function scrapePlaylistVideos(playlistUrl, options = {}) {
  const { maxVideos = 0, onProgress } = options;
  const listId = extractPlaylistId(playlistUrl);
  if (!listId) {
    throw new Error('Link playlist YouTube không hợp lệ');
  }

  const innertube = await getInnertube();
  const playlist = await innertube.getPlaylist(`VL${listId}`);
  const playlistName = playlist.info?.title?.trim() || null;
  const seen = new Set();
  const items = [];

  let page = playlist;

  while (page) {
    for (const entry of page.items || []) {
      const item = extractVideoFromLockup(entry);
      if (!item || seen.has(item.url)) continue;

      seen.add(item.url);
      items.push(item);

      if (onProgress) {
        onProgress({ count: items.length, playlistName });
      }

      if (maxVideos > 0 && items.length >= maxVideos) {
        return { playlistName, items };
      }
    }

    if (!page.has_continuation) break;
    page = await page.getContinuation();
  }

  return { playlistName, items };
}

module.exports = {
  isPlaylistUrl,
  normalizePlaylistUrl,
  extractPlaylistId,
  scrapePlaylistVideos,
};
