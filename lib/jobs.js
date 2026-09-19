const jobs = new Map();

function createJob(id, items, jobDir, options = {}) {
  const job = {
    id,
    status: 'running',
    jobDir,
    resolution: options.resolution || 'best',
    fastMode: Boolean(options.fastMode),
    items: items.map((item, index) => ({
      index,
      url: item.url,
      name: item.name || null,
      displayName: item.name || item.url,
      status: 'pending',
      error: null,
      filename: null,
      filePath: null,
    })),
    resultPath: null,
    resultName: null,
    error: null,
    completed: 0,
    failed: 0,
    total: items.length,
    updatedAt: Date.now(),
  };

  jobs.set(id, job);
  return job;
}

function getCompletedFiles(job, indices = null) {
  const allowed = indices ? new Set(indices) : null;

  return job.items
    .filter((item, index) => {
      if (item.status !== 'done' || !item.filePath) return false;
      return !allowed || allowed.has(index);
    })
    .map((item) => ({ name: item.filename, path: item.filePath }));
}

function getJob(id) {
  return jobs.get(id);
}

function snapshotJob(job) {
  if (!job) return null;

  const completedFiles = getCompletedFiles(job);

  return {
    id: job.id,
    status: job.status,
    items: job.items.map((item) => ({
      index: item.index,
      url: item.url,
      name: item.name,
      displayName: item.displayName,
      status: item.status,
      error: item.error,
      filename: item.filename,
      downloadable: item.status === 'done' && Boolean(item.filePath),
    })),
    completed: job.completed,
    failed: job.failed,
    total: job.total,
    resultName: job.resultName,
    error: job.error,
    hasDownloadableFiles: completedFiles.length > 0,
    downloadableCount: completedFiles.length,
  };
}

function touchJob(job) {
  job.updatedAt = Date.now();
}

function removeJob(id) {
  jobs.delete(id);
}

module.exports = {
  createJob,
  getJob,
  getCompletedFiles,
  snapshotJob,
  touchJob,
  removeJob,
};
