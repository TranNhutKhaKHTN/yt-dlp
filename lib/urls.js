const YOUTUBE_URL_PATTERN =
  /https?:\/\/(?:www\.)?(?:youtube\.com\/(?:watch\?(?:[^&\s]*&)*v=|shorts\/|embed\/)|youtu\.be\/)[\w-]{11}[^\s]*/gi;

function extractYoutubeUrls(text) {
  if (!text || typeof text !== 'string') return [];

  const matches = text.match(YOUTUBE_URL_PATTERN) || [];
  const seen = new Set();
  const urls = [];

  for (const raw of matches) {
    const url = raw.replace(/[),.;!?]+$/, '');
    const normalized = normalizeYoutubeUrl(url);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    urls.push(normalized);
  }

  return urls;
}

function extractVideoId(url) {
  try {
    const parsed = new URL(url);
    let videoId = null;

    if (parsed.hostname === 'youtu.be') {
      videoId = parsed.pathname.slice(1).split('/')[0];
    } else if (parsed.pathname.startsWith('/watch')) {
      videoId = parsed.searchParams.get('v');
    } else if (parsed.pathname.startsWith('/shorts/')) {
      videoId = parsed.pathname.split('/')[2];
    } else if (parsed.pathname.startsWith('/embed/')) {
      videoId = parsed.pathname.split('/')[2];
    }

    if (!videoId || !/^[\w-]{11}$/.test(videoId)) return null;
    return videoId;
  } catch {
    return null;
  }
}

function normalizeYoutubeUrl(url) {
  const videoId = extractVideoId(url);
  if (!videoId) return null;
  return `https://www.youtube.com/watch?v=${videoId}`;
}

function dedupeVideoItems(items) {
  const seen = new Set();
  const result = [];

  for (const item of items) {
    if (!item?.url || seen.has(item.url)) continue;
    seen.add(item.url);
    result.push(item.name ? { url: item.url, name: item.name } : { url: item.url });
  }

  return result;
}

function parseJsonVideoList(text) {
  let cleaned = text.trim();
  const fenceMatch = cleaned.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return null;
  }

  const arr = Array.isArray(parsed) ? parsed : [parsed];
  const items = [];

  for (const entry of arr) {
    if (!entry || typeof entry !== 'object') continue;

    const rawUrl = entry.url || entry.link;
    if (!rawUrl) continue;

    const url = normalizeYoutubeUrl(String(rawUrl).trim());
    if (!url) continue;

    const rawName = entry.name || entry.title;
    const name = rawName != null ? String(rawName).trim() : '';
    items.push(name ? { url, name } : { url });
  }

  return items.length ? items : null;
}

function parseLineVideoList(text) {
  const items = [];

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const namedMatch = trimmed.match(/^(.+?)\s*[|,\t]\s*(https?:\/\/.+)$/i);
    if (namedMatch) {
      const name = namedMatch[1].trim();
      const url = normalizeYoutubeUrl(namedMatch[2].trim().replace(/[),.;!?]+$/, ''));
      if (url) {
        items.push(name ? { url, name } : { url });
      }
      continue;
    }

    const urls = extractYoutubeUrls(trimmed);
    if (urls.length === 1) {
      items.push({ url: urls[0] });
    } else {
      for (const url of urls) {
        items.push({ url });
      }
    }
  }

  return items;
}

function parseVideoList(text) {
  if (!text || typeof text !== 'string') return [];

  const jsonItems = parseJsonVideoList(text);
  if (jsonItems) {
    return dedupeVideoItems(jsonItems);
  }

  const lineItems = parseLineVideoList(text);
  if (lineItems.length) {
    return dedupeVideoItems(lineItems);
  }

  return extractYoutubeUrls(text).map((url) => ({ url }));
}

function validateVideoList(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('Cần ít nhất một video trong danh sách');
  }

  const normalized = [];
  const seen = new Set();

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    let url = null;
    let name = null;

    if (typeof item === 'string') {
      url = normalizeYoutubeUrl(item.trim());
    } else if (item && typeof item === 'object') {
      if (item.url) {
        url = normalizeYoutubeUrl(String(item.url).trim());
      }
      if (item.name != null && String(item.name).trim()) {
        name = String(item.name).trim();
      }
    }

    if (!url) {
      throw new Error(`Video ${i + 1}: không phải link YouTube hợp lệ`);
    }

    if (seen.has(url)) continue;
    seen.add(url);

    normalized.push(name ? { url, name } : { url });
  }

  if (normalized.length === 0) {
    throw new Error('Không tìm thấy link YouTube hợp lệ');
  }

  return normalized;
}

function validateUrlList(urls) {
  return validateVideoList(urls).map((item) => item.url);
}

module.exports = {
  extractYoutubeUrls,
  extractVideoId,
  normalizeYoutubeUrl,
  parseVideoList,
  validateVideoList,
  validateUrlList,
};
