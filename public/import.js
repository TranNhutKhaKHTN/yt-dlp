const VALID_RESOLUTIONS = ['best', '1080', '720', '480', '360'];

function secondsToTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;

  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

function normalizeTimeInput(value) {
  const trimmed = String(value).trim();
  if (!trimmed) throw new Error('Thời gian không hợp lệ');

  if (/^\d+$/.test(trimmed)) return trimmed;

  const hmmMatch = trimmed.match(/^(\d{3,}):(\d{2})$/);
  if (hmmMatch) {
    const hmm = parseInt(hmmMatch[1], 10);
    const sec = parseInt(hmmMatch[2], 10);
    const h = Math.floor(hmm / 100);
    const m = hmm % 100;
    if (m >= 60) {
      return secondsToTime(hmm * 60 + sec);
    }
    return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }

  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(trimmed)) return trimmed;

  throw new Error(`Định dạng thời gian không hợp lệ: ${trimmed}`);
}

function parseTimeInput(value) {
  return normalizeTimeInput(value);
}

function timeToSeconds(value) {
  const trimmed = parseTimeInput(value);
  if (/^\d+$/.test(trimmed)) return parseInt(trimmed, 10);

  const parts = trimmed.split(':').map((p) => parseInt(p, 10));
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

function parseAiJson(text) {
  let cleaned = text.trim();
  const fenceMatch = cleaned.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }
  return JSON.parse(cleaned);
}

function validateImport(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('JSON phải là object');
  }

  if (!data.url || typeof data.url !== 'string') {
    throw new Error('Thiếu trường url');
  }

  if (!Array.isArray(data.segments) || data.segments.length === 0) {
    throw new Error('Cần ít nhất một phân đoạn trong segments');
  }

  const segments = data.segments.map((seg, index) => {
    if (!seg.startTime || !seg.endTime) {
      throw new Error(`Phân đoạn ${index + 1}: thiếu startTime hoặc endTime`);
    }

    const start = parseTimeInput(seg.startTime);
    const end = parseTimeInput(seg.endTime);
    const startSec = timeToSeconds(start);
    const endSec = timeToSeconds(end);

    if (startSec >= endSec) {
      throw new Error(`Phân đoạn ${index + 1}: thời gian bắt đầu phải nhỏ hơn kết thúc`);
    }

    return {
      startTime: start,
      endTime: end,
      title: seg.title ? String(seg.title) : '',
    };
  });

  const result = { url: data.url.trim(), segments };

  if (data.resolution != null) {
    if (!VALID_RESOLUTIONS.includes(String(data.resolution))) {
      throw new Error('resolution không hợp lệ');
    }
    result.resolution = String(data.resolution);
  }

  if (data.fastMode != null) {
    result.fastMode = Boolean(data.fastMode);
  }

  return result;
}

function applyImport(data, ui) {
  ui.urlInput.value = data.url;

  if (data.resolution) {
    ui.resolutionSelect.value = data.resolution;
  }

  if (data.fastMode != null) {
    ui.fastModeCheckbox.checked = data.fastMode;
  }

  ui.segmentsEl.innerHTML = '';

  for (const seg of data.segments) {
    ui.createSegmentRow(seg.startTime, seg.endTime, seg.title);
  }
}
