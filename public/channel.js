const IMPORT_KEY = 'videoDlyChannelImport';

const form = document.getElementById('form');
const sourceUrlEl = document.getElementById('sourceUrl');
const sourceLabelEl = document.getElementById('sourceLabel');
const sourceHintEl = document.getElementById('sourceHint');
const pageDescEl = document.getElementById('pageDesc');
const maxVideosEl = document.getElementById('maxVideos');
const scrapeBtn = document.getElementById('scrapeBtn');
const statusEl = document.getElementById('status');
const resultSection = document.getElementById('resultSection');
const resultTitle = document.getElementById('resultTitle');
const resultCount = document.getElementById('resultCount');
const videoListEl = document.getElementById('videoList');
const copyBtn = document.getElementById('copyBtn');
const importBtn = document.getElementById('importBtn');
const modeChannelBtn = document.getElementById('modeChannelBtn');
const modePlaylistBtn = document.getElementById('modePlaylistBtn');

let scrapedItems = [];
let currentMode = 'channel';

const MODE_CONFIG = {
  channel: {
    label: 'Link kênh YouTube',
    placeholder: 'https://www.youtube.com/@ten-kenh',
    hint: 'Hỗ trợ: @handle, /channel/UC..., /c/..., /user/...',
    desc: 'Nhập link kênh để lấy toàn bộ URL video, sau đó chuyển sang trang tải video.',
    button: 'Cào video từ kênh',
    loading: 'Đang cào video từ kênh, có thể mất vài phút nếu kênh lớn...',
    api: '/api/scrape-channel',
    resultPrefix: 'Kênh',
    nameField: 'channelName',
    success: (count) => `Đã lấy ${count} video từ kênh.`,
    error: 'Cào kênh thất bại',
  },
  playlist: {
    label: 'Link playlist YouTube',
    placeholder: 'https://www.youtube.com/playlist?list=PL...',
    hint: 'Hỗ trợ: /playlist?list=PL..., hoặc /watch?v=...&list=PL...',
    desc: 'Nhập link playlist để lấy toàn bộ URL video, sau đó chuyển sang trang tải video.',
    button: 'Cào video từ playlist',
    loading: 'Đang cào video từ playlist, có thể mất vài phút nếu playlist lớn...',
    api: '/api/scrape-playlist',
    resultPrefix: 'Playlist',
    nameField: 'playlistName',
    success: (count) => `Đã lấy ${count} video từ playlist.`,
    error: 'Cào playlist thất bại',
  },
};

function setStatus(type, message) {
  statusEl.className = 'status ' + type;
  statusEl.textContent = message;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function setMode(mode) {
  currentMode = mode;
  const config = MODE_CONFIG[mode];
  const isChannel = mode === 'channel';

  modeChannelBtn.classList.toggle('active', isChannel);
  modePlaylistBtn.classList.toggle('active', !isChannel);
  sourceLabelEl.textContent = config.label;
  sourceUrlEl.placeholder = config.placeholder;
  sourceHintEl.textContent = config.hint;
  pageDescEl.textContent = config.desc;
  scrapeBtn.textContent = config.button;
}

function renderResults(sourceName, items) {
  scrapedItems = items;
  const config = MODE_CONFIG[currentMode];
  resultSection.classList.remove('hidden');
  resultTitle.textContent = sourceName ? `${config.resultPrefix}: ${sourceName}` : 'Kết quả';
  resultCount.textContent = `${items.length} video`;
  videoListEl.innerHTML = items.map((item, i) => {
    const title = item.youtubeTitle || item.name || item.url;
    return `
      <div class="video-item">
        <span class="video-title">${i + 1}. ${escapeHtml(title)}</span>
        <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener">${escapeHtml(item.url)}</a>
      </div>
    `;
  }).join('');
}

function saveForImport(items) {
  sessionStorage.setItem(IMPORT_KEY, JSON.stringify(items));
}

modeChannelBtn.addEventListener('click', () => setMode('channel'));
modePlaylistBtn.addEventListener('click', () => setMode('playlist'));

form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const config = MODE_CONFIG[currentMode];
  scrapeBtn.disabled = true;
  copyBtn.disabled = true;
  importBtn.disabled = true;
  resultSection.classList.add('hidden');
  setStatus('loading', config.loading);

  const maxRaw = maxVideosEl.value.trim();
  const maxVideos = maxRaw ? parseInt(maxRaw, 10) : 0;

  try {
    const res = await fetch(config.api, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: sourceUrlEl.value.trim(),
        maxVideos: maxVideos > 0 ? maxVideos : 0,
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || config.error);
    }

    renderResults(data[config.nameField], data.items);
    setStatus('success', config.success(data.count));
  } catch (err) {
    setStatus('error', err.message);
  } finally {
    scrapeBtn.disabled = false;
    copyBtn.disabled = false;
    importBtn.disabled = false;
  }
});

copyBtn.addEventListener('click', async () => {
  if (!scrapedItems.length) return;

  try {
    await navigator.clipboard.writeText(formatVideoList(scrapedItems));
    setStatus('success', `Đã sao chép ${scrapedItems.length} link vào clipboard.`);
  } catch {
    setStatus('error', 'Không thể sao chép. Hãy copy thủ công.');
  }
});

importBtn.addEventListener('click', () => {
  if (!scrapedItems.length) return;

  saveForImport(scrapedItems);
  window.location.href = '/?import=channel';
});
