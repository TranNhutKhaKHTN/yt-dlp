const { secondsToTime } = require('./time');

function splitRange(startSec, endSec, chunkSizeSec = 60) {
  const chunks = [];
  let current = startSec;

  while (current < endSec) {
    const chunkEnd = Math.min(current + chunkSizeSec, endSec);
    chunks.push({
      startSec: current,
      endSec: chunkEnd,
      start: secondsToTime(current),
      end: secondsToTime(chunkEnd),
    });
    current = chunkEnd;
  }

  return chunks;
}

module.exports = { splitRange };
