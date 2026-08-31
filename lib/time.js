function parseTimeInput(value) {
  const trimmed = String(value).trim();
  if (!trimmed) throw new Error('Thời gian không hợp lệ');
  if (/^\d+$/.test(trimmed)) return trimmed;
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(trimmed)) return trimmed;
  throw new Error(`Định dạng thời gian không hợp lệ: ${trimmed}`);
}

function timeToSeconds(value) {
  const trimmed = parseTimeInput(value);
  if (/^\d+$/.test(trimmed)) return parseInt(trimmed, 10);

  const parts = trimmed.split(':').map((p) => parseInt(p, 10));
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

function secondsToTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;

  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

function validateRange(startTime, endTime) {
  const start = parseTimeInput(startTime);
  const end = parseTimeInput(endTime);
  const startSec = timeToSeconds(start);
  const endSec = timeToSeconds(end);

  if (startSec >= endSec) {
    throw new Error('Thời gian bắt đầu phải nhỏ hơn thời gian kết thúc');
  }

  return { start, end, startSec, endSec, durationSec: endSec - startSec };
}

function validateSegments(segments) {
  if (!Array.isArray(segments) || segments.length === 0) {
    throw new Error('Cần ít nhất một phân đoạn');
  }

  return segments.map((seg, index) => {
    if (!seg.startTime || !seg.endTime) {
      throw new Error(`Phân đoạn ${index + 1}: thiếu thời gian bắt đầu hoặc kết thúc`);
    }
    try {
      return { ...validateRange(seg.startTime, seg.endTime), index };
    } catch (err) {
      throw new Error(`Phân đoạn ${index + 1}: ${err.message}`);
    }
  });
}

function sanitizeFilename(value) {
  return String(value).replace(/:/g, '-').replace(/[^\w.-]/g, '_');
}

module.exports = {
  parseTimeInput,
  timeToSeconds,
  secondsToTime,
  validateRange,
  validateSegments,
  sanitizeFilename,
};
