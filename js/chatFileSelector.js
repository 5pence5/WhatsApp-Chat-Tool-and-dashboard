const WHATSAPP_NAME_PATTERNS = [
  /^WhatsApp Chat with .+\.txt$/i,
  /^WhatsApp Chat - .+\.txt$/i,
  /^WhatsApp Group Chat with .+\.txt$/i,
  /^WhatsApp Group Chat - .+\.txt$/i,
  /^WhatsApp Chat\.txt$/i,
  /^WhatsApp Group Chat\.txt$/i
];

const WHATSAPP_KEYWORD_PATTERN = /whatsapp/i;

function normaliseCandidate(candidate = {}) {
  const name = String(candidate.name || '');
  const path = typeof candidate.path === 'string' ? candidate.path : name;
  const baseName = name.split('/').pop() || name;
  const size = Number.isFinite(candidate.size) ? candidate.size : 0;
  return {
    ...candidate,
    name,
    path,
    baseName,
    size
  };
}

function computeScore(candidate) {
  let score = 0;
  if (WHATSAPP_NAME_PATTERNS.some((pattern) => pattern.test(candidate.baseName))) {
    score += 6;
  } else if (WHATSAPP_KEYWORD_PATTERN.test(candidate.baseName)) {
    score += 3;
  }

  if (!candidate.path.startsWith('__MACOSX/') && !candidate.path.includes('/.__MACOSX/')) {
    score += 1;
  } else {
    score -= 3;
  }

  if (candidate.size > 0) {
    score += 1;
  }

  return score;
}

export function chooseChatFileCandidate(rawCandidates = []) {
  const candidates = rawCandidates
    .map(normaliseCandidate)
    .filter((candidate) => candidate.baseName.toLowerCase().endsWith('.txt') && !candidate.baseName.startsWith('._'));

  if (!candidates.length) {
    return { type: 'none', candidates: [] };
  }

  const scored = candidates.map((candidate) => ({
    candidate,
    score: computeScore(candidate)
  }));

  const highestScore = Math.max(...scored.map((entry) => entry.score));
  const bestByScore = scored.filter((entry) => entry.score === highestScore);

  const maxSize = Math.max(...bestByScore.map((entry) => entry.candidate.size));
  const largest = bestByScore.filter((entry) => entry.candidate.size === maxSize);

  if (largest.length === 1) {
    return { type: 'selected', candidate: largest[0].candidate };
  }

  const ambiguous = largest
    .map((entry) => entry.candidate)
    .sort((a, b) => {
      if (b.size !== a.size) {
        return b.size - a.size;
      }
      return a.baseName.localeCompare(b.baseName, undefined, { sensitivity: 'base' });
    });

  return { type: 'ambiguous', candidates: ambiguous };
}

export function formatCandidateLabel(candidate) {
  const size = Number.isFinite(candidate?.size) ? candidate.size : 0;
  const sizeLabel = size ? formatBytes(size) : 'unknown size';
  const baseName = candidate?.baseName || candidate?.name || 'Unknown file';
  return `${baseName} (${sizeLabel})`;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const rounded = value >= 10 || unitIndex === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unitIndex]}`;
}

export function formatBytesForDisplay(bytes) {
  return formatBytes(bytes);
}
