const { getInnertube } = require('./youtube-meta');
const { normalizeYoutubeUrl } = require('./urls');

const CHANNEL_URL_PATTERN =
  /^https?:\/\/(?:www\.)?youtube\.com\/(?:@[\w.-]+|channel\/[\w-]+|c\/[\w.-]+|user\/[\w.-]+)(?:\/(?:videos|shorts|streams|playlists|featured|about|community|channels))?\/?(?:[?#].*)?$/i;

function isChannelUrl(url) {
  if (!url || typeof url !== 'string') return false;
  return CHANNEL_URL_PATTERN.test(url.trim());
}

function normalizeChannelUrl(url) {
  const trimmed = url.trim();
  if (!isChannelUrl(trimmed)) {
    throw new Error('Link kênh YouTube không hợp lệ');
  }
  return trimmed.replace(/\/(videos|shorts|streams|playlists|featured|about|community|channels)\/?$/i, '');
}

function extractVideoFromLockup(item) {
  if (!item || item.content_type !== 'VIDEO' || !item.content_id) return null;

  const title = item.metadata?.title?.text?.trim()
    || item.metadata?.title?.toString?.()?.trim()
    || null;

  const url = normalizeYoutubeUrl(`https://www.youtube.com/watch?v=${item.content_id}`);
  if (!url) return null;

  return title ? { url, name: title, youtubeTitle: title } : { url };
}

async function resolveChannelId(innertube, channelUrl) {
  const endpoint = await innertube.resolveURL(channelUrl);
  const browseId = endpoint.payload?.browseId;
  if (browseId) return browseId;

  const path = channelUrl.replace(/^https?:\/\/(?:www\.)?youtube\.com\//i, '');
  return path.split(/[/?#]/)[0];
}

async function scrapeChannelVideos(channelUrl, options = {}) {
  const { maxVideos = 0, onProgress } = options;
  const normalizedUrl = normalizeChannelUrl(channelUrl);
  const innertube = await getInnertube();
  const channelId = await resolveChannelId(innertube, normalizedUrl);
  const channel = await innertube.getChannel(channelId);

  const channelName = channel.metadata?.title?.trim() || null;
  const seen = new Set();
  const items = [];

  let page = await channel.getVideos();

  while (page) {
    for (const entry of page.videos || []) {
      const item = extractVideoFromLockup(entry);
      if (!item || seen.has(item.url)) continue;

      seen.add(item.url);
      items.push(item);

      if (onProgress) {
        onProgress({ count: items.length, channelName });
      }

      if (maxVideos > 0 && items.length >= maxVideos) {
        return { channelName, items };
      }
    }

    if (!page.has_continuation) break;
    page = await page.getContinuation();
  }

  return { channelName, items };
}

module.exports = {
  isChannelUrl,
  normalizeChannelUrl,
  extractVideoFromLockup,
  scrapeChannelVideos,
};
