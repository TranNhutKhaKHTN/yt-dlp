const { extractVideoId } = require('./urls');

let clientPromise = null;

async function getInnertube() {
  if (!clientPromise) {
    clientPromise = import('youtubei.js').then(({ Innertube }) => Innertube.create());
  }
  return clientPromise;
}

async function getVideoTitle(url) {
  const videoId = extractVideoId(url);
  if (!videoId) {
    throw new Error('Không parse được video ID');
  }

  const innertube = await getInnertube();
  const info = await innertube.getBasicInfo(videoId);
  const title = info?.basic_info?.title?.trim();

  if (!title) {
    throw new Error('Không lấy được tên video');
  }

  return title;
}

async function resolveVideoTitles(items, concurrency = 4) {
  const results = items.map((item) => ({ ...item }));
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      try {
        results[i].youtubeTitle = await getVideoTitle(items[i].url);
      } catch {
        results[i].youtubeTitle = items[i].name || null;
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, worker),
  );

  return results;
}

module.exports = {
  getInnertube,
  getVideoTitle,
  resolveVideoTitles,
};
