const headerPatterns = [
  {
    regex: /^\[(\d{1,2})\/(\d{1,2})\/(\d{2,4}),\s([^\]]+)\]\s(.+)$/
  },
  {
    regex: /^(\d{1,2})\/(\d{1,2})\/(\d{2,4}),\s(\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AP]M)?)\s-\s(.+)$/
  }
];

const stopWords = new Set([
  'the','and','you','for','that','with','this','have','but','not','are','your','was','get','got','just','they','them','what','when','from','there','their','would','could','about','will','cant','dont','didnt','im','its','were','had','has','how','all','out','now','like','yeah','yes','she','his','her','who','him','our','one','why','too','wasnt','havent','into','then','than','ill','ive','did','okay','ok','sure','well','also','more','some','been','over','here','back','much','make','really','know','going','want','time','see','let','say','good','thanks','thank','thats','doesnt','aint','u','ur','lol','omg','lmfao','lmao','haha','hahaha','http','https','to','is','in','on','at','we','me','my','do','if','as','be','an','or','by','no','up','so','it','he','ya','oh','hadnt','should','ive','theyll','theyd','theirs','ours','mine','of','can'
]);

function matchMessageHeader(line) {
  for (const { regex } of headerPatterns) {
    const match = line.match(regex);
    if (match) {
      return {
        day: match[1],
        month: match[2],
        year: match[3],
        time: match[4].replace(/[\u202f\u00a0]/g, ' ').trim(),
        rest: match[5]
      };
    }
  }
  return null;
}

function determineDateFormat(lines) {
  const ambiguousSamples = [];

  for (const line of lines) {
    const header = matchMessageHeader(line);
    if (!header) continue;

    const first = parseInt(header.day, 10);
    const second = parseInt(header.month, 10);

    if (first > 12 && second <= 12) {
      return { format: 'DMY', ambiguous: false, candidates: [] };
    }

    if (second > 12 && first <= 12) {
      return { format: 'MDY', ambiguous: false, candidates: [] };
    }

    if (first <= 12 && second <= 12) {
      ambiguousSamples.push(header);
      if (ambiguousSamples.length >= 50) {
        break;
      }
    }
  }

  if (!ambiguousSamples.length) {
    return { format: 'DMY', ambiguous: false, candidates: [] };
  }

  const evaluateFormat = (format) => {
    let previous = null;
    let decreases = 0;
    let validCount = 0;
    let firstDate = null;
    let lastDate = null;

    for (const sample of ambiguousSamples) {
      const candidateDate = parseDate(sample.day, sample.month, sample.year, sample.time, format);
      if (Number.isNaN(candidateDate.getTime())) continue;

      if (!firstDate) {
        firstDate = candidateDate;
      }

      if (previous && candidateDate.getTime() < previous.getTime()) {
        decreases += 1;
      }

      previous = candidateDate;
      lastDate = candidateDate;
      validCount += 1;
    }

    const span = firstDate && lastDate ? Math.abs(lastDate.getTime() - firstDate.getTime()) : 0;

    return { format, decreases, span, validCount };
  };

  const evaluations = ['DMY', 'MDY'].map((format) => evaluateFormat(format));

  const best = evaluations.reduce((currentBest, candidate) => {
    if (!currentBest) return candidate;

    if (candidate.decreases !== currentBest.decreases) {
      return candidate.decreases < currentBest.decreases ? candidate : currentBest;
    }

    if (candidate.span !== currentBest.span) {
      return candidate.span < currentBest.span ? candidate : currentBest;
    }

    if (candidate.validCount !== currentBest.validCount) {
      return candidate.validCount > currentBest.validCount ? candidate : currentBest;
    }

    return currentBest;
  }, null);

  return {
    format: best.format,
    ambiguous: true,
    candidates: evaluations
  };
}

function parseDate(day, month, year, timeStr, format) {
  let d = parseInt(day, 10);
  let m = parseInt(month, 10);
  let y = parseInt(year, 10);

  if (format === 'MDY') {
    [d, m] = [m, d];
  }

  if (y < 100) {
    y += y >= 70 ? 1900 : 2000;
  }

  let hours = 0;
  let minutes = 0;
  let seconds = 0;
  let period = null;
  const timeMatch = timeStr.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s?([AP]M))?$/i);
  if (timeMatch) {
    hours = parseInt(timeMatch[1], 10);
    minutes = parseInt(timeMatch[2], 10);
    seconds = timeMatch[3] ? parseInt(timeMatch[3], 10) : 0;
    period = timeMatch[4];
  }

  if (period) {
    const upper = period.toUpperCase();
    if (upper === 'PM' && hours < 12) {
      hours += 12;
    }
    if (upper === 'AM' && hours === 12) {
      hours = 0;
    }
  }

  return new Date(y, m - 1, d, hours, minutes, seconds);
}

function formatLocalDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatLocalDateTime(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

function normaliseAuthor(author) {
  if (!author) return 'System';
  return author.replace(/^"|"$/g, '').trim();
}

export function parseChat(rawText, options = {}) {
  const { dateFormat: dateFormatOverride } = options;

  if (!rawText) {
    return {
      messages: [],
      dateFormat: dateFormatOverride || 'DMY',
      ambiguous: false,
      candidates: [],
      usedOverride: Boolean(dateFormatOverride)
    };
  }
  const text = rawText.replace(/\uFEFF/g, '');
  const lines = text.split(/\r?\n/);
  const determination = determineDateFormat(lines);
  const format = dateFormatOverride || determination.format;

  const messages = [];
  let current = null;

  for (const line of lines) {
    const header = matchMessageHeader(line);
    if (header) {
      if (current) {
        current.content = current.content.trim();
        messages.push(current);
      }
      const timestamp = parseDate(header.day, header.month, header.year, header.time, format);
      const authorSplit = header.rest.split(/:\s/);
      if (authorSplit.length >= 2) {
        const author = normaliseAuthor(authorSplit.shift());
        const content = authorSplit.join(': ').trim();
        current = {
          timestamp,
          author,
          content,
          type: 'message'
        };
      } else {
        current = {
          timestamp,
          author: 'System',
          content: header.rest.trim(),
          type: 'system'
        };
      }
    } else if (current) {
      current.content += `\n${line}`;
    }
  }

  if (current) {
    current.content = current.content.trim();
    messages.push(current);
  }

  const filtered = messages.filter((msg) => !Number.isNaN(msg.timestamp.getTime()));

  return {
    messages: filtered,
    dateFormat: format,
    ambiguous: determination.ambiguous,
    candidates: determination.candidates,
    usedOverride: Boolean(dateFormatOverride)
  };
}

function isMediaMessage(content) {
  if (!content) return false;
  const lc = content.toLowerCase();
  return lc.includes('omitted') || lc.includes('<media') || lc.includes('image omitted') || lc.includes('video omitted');
}

function extractWords(content) {
  return content
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .split(/\s+/)
    .map((word) => word.replace(/^'+|'+$/g, '').replace(/'/g, ''))
    .filter((word) => word.length > 1 && !stopWords.has(word));
}

function extractEmojis(content) {
  if (!content) return [];
  const match = content.match(/\p{Extended_Pictographic}/gu);
  return match ? match : [];
}

function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function computeStatistics(messages, options = {}) {
  const {
    responseGapMinutes,
    overnightBufferMinutes
  } = options;

  const baseResponseGap = typeof responseGapMinutes === 'number' && responseGapMinutes > 0
    ? responseGapMinutes
    : null;
  const overnightBuffer = typeof overnightBufferMinutes === 'number' && overnightBufferMinutes > 0
    ? overnightBufferMinutes
    : 0;

  if (!messages.length) {
    return {
      totalMessages: 0,
      totalWords: 0,
      overallAverageWordsPerMessage: 0,
      participants: [],
      messageCountByParticipant: {},
      wordCountByParticipant: {},
      averageWordsPerMessage: {},
      mediaCount: 0,
      systemCount: 0,
      firstMessageDate: null,
      lastMessageDate: null,
      messagesByDate: new Map(),
      messagesByHour: new Array(24).fill(0),
      topWords: [],
      topEmojis: [],
      averageMessageLength: {},
      busiestDay: null,
      busiestHour: null,
      longestStreak: 0,
      longestStreakRange: null,
      responseTimes: {},
      longestMessageByParticipant: {},
      responseGapMinutes: baseResponseGap,
      responseGapOvernightBufferMinutes: baseResponseGap ? overnightBuffer : 0
    };
  }

  const participantsSet = new Set();
  const messageCountByParticipant = {};
  const wordCountByParticipant = {};
  const totalWordsByParticipant = {};
  const longestMessageByParticipant = {};
  const messagesByDate = new Map();
  const messagesByHour = new Array(24).fill(0);
  const words = [];
  const emojiCounts = new Map();
  const responseTracking = {};
  const responseTimes = {};

  let totalMessages = 0;
  let totalWords = 0;
  let mediaCount = 0;
  let systemCount = 0;

  const sortedMessages = [...messages].sort((a, b) => a.timestamp - b.timestamp);

  let previousMessage = null;

  for (const message of sortedMessages) {
    if (message.type === 'system') {
      systemCount += 1;
      previousMessage = message;
      continue;
    }

    const dateKey = formatLocalDateKey(message.timestamp);
    messagesByDate.set(dateKey, (messagesByDate.get(dateKey) || 0) + 1);
    messagesByHour[message.timestamp.getHours()] += 1;

    const author = message.author;
    participantsSet.add(author);
    messageCountByParticipant[author] = (messageCountByParticipant[author] || 0) + 1;

    if (!(author in wordCountByParticipant)) {
      wordCountByParticipant[author] = 0;
    }
    if (!(author in totalWordsByParticipant)) {
      totalWordsByParticipant[author] = 0;
    }
    if (!(author in longestMessageByParticipant)) {
      longestMessageByParticipant[author] = null;
    }

    totalMessages += 1;

    const content = message.content || '';
    const trimmedContent = content.trim();
    const charCount = trimmedContent.length;
    let wordList = [];
    let descriptiveWordCount = 0;

    const mediaMessage = isMediaMessage(content);

    if (mediaMessage) {
      mediaCount += 1;
    } else {
      wordList = extractWords(content);
      wordCountByParticipant[author] += wordList.length;
      totalWordsByParticipant[author] += content.length;
      totalWords += wordList.length;
      words.push(...wordList);
      const emojis = extractEmojis(message.content);
      for (const emoji of emojis) {
        emojiCounts.set(emoji, (emojiCounts.get(emoji) || 0) + 1);
      }
      descriptiveWordCount = trimmedContent ? trimmedContent.split(/\s+/).filter(Boolean).length : 0;
    }

    if (!mediaMessage && (descriptiveWordCount > 0 || charCount > 0)) {
      const currentLongest = longestMessageByParticipant[author];
      const shouldReplace = !currentLongest
        || descriptiveWordCount > currentLongest.wordCount
        || (descriptiveWordCount === currentLongest.wordCount && charCount > currentLongest.charCount)
        || (descriptiveWordCount === currentLongest.wordCount && charCount === currentLongest.charCount
          && message.timestamp < currentLongest.timestamp);

      if (shouldReplace) {
        longestMessageByParticipant[author] = {
          timestamp: message.timestamp,
          content: message.content,
          wordCount: descriptiveWordCount,
          charCount
        };
      }
    }

    if (previousMessage && previousMessage.type === 'message' && previousMessage.author !== author) {
      const delta = (message.timestamp - previousMessage.timestamp) / 60000;
      const crossesOvernight = message.timestamp.toDateString() !== previousMessage.timestamp.toDateString();
      const allowance = baseResponseGap === null
        ? null
        : baseResponseGap + (crossesOvernight ? overnightBuffer : 0);

      if (!responseTracking[author]) {
        responseTracking[author] = [];
      }

      if (allowance === null || delta <= allowance) {
        responseTracking[author].push(delta);
      }
    }

    previousMessage = message;
  }

  const participants = Array.from(participantsSet).sort((a, b) => (messageCountByParticipant[b] || 0) - (messageCountByParticipant[a] || 0));

  for (const [author, deltas] of Object.entries(responseTracking)) {
    if (deltas.length) {
      const avg = deltas.reduce((acc, value) => acc + value, 0) / deltas.length;
      responseTimes[author] = round(avg, 2);
    }
  }

  const topWords = Object.entries(words.reduce((acc, word) => {
    acc[word] = (acc[word] || 0) + 1;
    return acc;
  }, {})).sort((a, b) => b[1] - a[1]).slice(0, 15);

  const topEmojis = Array.from(emojiCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10);

  const averageMessageLength = {};
  const averageWordsPerMessage = {};
  for (const participant of participants) {
    const count = messageCountByParticipant[participant] || 0;
    averageMessageLength[participant] = count ? round(totalWordsByParticipant[participant] / count, 1) : 0;
    const words = wordCountByParticipant[participant] || 0;
    averageWordsPerMessage[participant] = count ? round(words / count, 1) : 0;
  }

  const overallAverageWordsPerMessage = totalMessages ? round(totalWords / totalMessages, 1) : 0;

  const [firstMessageDate] = sortedMessages;
  const lastMessageDate = sortedMessages[sortedMessages.length - 1];

  let busiestDay = null;
  let busiestDayCount = 0;
  for (const [date, count] of messagesByDate.entries()) {
    if (count > busiestDayCount) {
      busiestDayCount = count;
      busiestDay = { date, count };
    }
  }

  let busiestHour = null;
  let busiestHourCount = 0;
  messagesByHour.forEach((count, hour) => {
    if (count > busiestHourCount) {
      busiestHourCount = count;
      busiestHour = hour;
    }
  });

  if (busiestHourCount === 0) {
    busiestHour = null;
  }

  const streaks = calculateStreaks(messagesByDate);

  return {
    totalMessages,
    totalWords,
    overallAverageWordsPerMessage,
    participants,
    messageCountByParticipant,
    wordCountByParticipant,
    averageWordsPerMessage,
    mediaCount,
    systemCount,
    firstMessageDate: firstMessageDate?.timestamp ?? null,
    lastMessageDate: lastMessageDate?.timestamp ?? null,
    messagesByDate,
    messagesByHour,
    topWords,
    topEmojis,
    averageMessageLength,
    busiestDay,
    busiestHour,
    longestStreak: streaks.length,
    longestStreakRange: streaks.range,
    responseTimes,
    longestMessageByParticipant,
    responseGapMinutes: baseResponseGap,
    responseGapOvernightBufferMinutes: baseResponseGap ? overnightBuffer : 0
  };
}

function calculateStreaks(messagesByDate) {
  const dates = Array.from(messagesByDate.keys()).sort();
  if (!dates.length) {
    return { length: 0, range: null };
  }

  let bestLength = 1;
  let currentLength = 1;
  let bestRange = { start: dates[0], end: dates[0] };
  let currentStart = dates[0];

  for (let i = 1; i < dates.length; i += 1) {
    const prev = new Date(dates[i - 1]);
    const current = new Date(dates[i]);
    const diff = (current - prev) / 86400000;

    if (diff === 1) {
      currentLength += 1;
    } else {
      if (currentLength > bestLength) {
        bestLength = currentLength;
        bestRange = { start: currentStart, end: dates[i - 1] };
      }
      currentLength = 1;
      currentStart = dates[i];
    }
  }

  if (currentLength > bestLength) {
    bestLength = currentLength;
    bestRange = { start: currentStart, end: dates[dates.length - 1] };
  }

  return { length: bestLength, range: bestRange };
}

function parseDateInput(value) {
  if (!value) return null;
  const [year, month, day] = value.split('-').map((part) => parseInt(part, 10));
  if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) {
    return null;
  }
  return new Date(year, month - 1, day);
}

export function filterMessagesByDate(messages, startDate, endDate) {
  if (!startDate && !endDate) return [...messages];
  const start = parseDateInput(startDate);
  const end = parseDateInput(endDate);

  return messages.filter((message) => {
    const ts = message.timestamp;
    if (start && ts < start) return false;
    if (end) {
      const endOfDay = new Date(end.getTime());
      endOfDay.setHours(23, 59, 59, 999);
      if (ts > endOfDay) return false;
    }
    return true;
  });
}

export function generateMarkdownSummary({
  title = 'WhatsApp Chat Summary',
  messages,
  stats,
  startDate,
  endDate,
  sampleCount = 3
}) {
  const lines = [];
  lines.push(`# ${title}`);
  const dateLine = startDate && endDate
    ? `**Timeframe:** ${startDate} → ${endDate}`
    : stats.firstMessageDate && stats.lastMessageDate
      ? `**Timeframe:** ${formatLocalDateKey(stats.firstMessageDate)} → ${formatLocalDateKey(stats.lastMessageDate)}`
      : null;
  if (dateLine) lines.push(dateLine);

  lines.push('');
  lines.push(`- **Messages analysed:** ${stats.totalMessages.toLocaleString()}`);
  lines.push(`- **Unique participants:** ${stats.participants.length}`);
  if (stats.mediaCount) {
    lines.push(`- **Media shared:** ${stats.mediaCount}`);
  }
  if (typeof stats.overallAverageWordsPerMessage === 'number' && stats.overallAverageWordsPerMessage > 0) {
    const formattedAverage = stats.overallAverageWordsPerMessage.toLocaleString(undefined, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1
    });
    lines.push(`- **Average words per message:** ${formattedAverage}`);
  }
  if (stats.topWords.length) {
    lines.push(`- **Top themes:** ${stats.topWords.slice(0, 5).map(([word]) => `\`${word}\``).join(', ')}`);
  }
  if (stats.longestStreak > 1 && stats.longestStreakRange) {
    lines.push(`- **Longest daily streak:** ${stats.longestStreak} days (${stats.longestStreakRange.start} → ${stats.longestStreakRange.end})`);
  }

  lines.push('\n## Participation');
  for (const participant of stats.participants) {
    const count = stats.messageCountByParticipant[participant];
    const words = stats.wordCountByParticipant[participant];
    const wordsPerMessage = stats.averageWordsPerMessage?.[participant];
    const avgLength = stats.averageMessageLength[participant];
    const response = stats.responseTimes[participant];
    const longest = stats.longestMessageByParticipant?.[participant];
    const bits = [`${participant}: **${count.toLocaleString()}** messages`];
    if (words) bits.push(`${words.toLocaleString()} words`);
    if (wordsPerMessage) {
      bits.push(`${wordsPerMessage.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} words/msg`);
    }
    if (avgLength) bits.push(`avg length ${avgLength} chars`);
    if (response) bits.push(`average response ≈ ${response} min`);
    if (longest) {
      const descriptor = longest.wordCount
        ? `${longest.wordCount} ${longest.wordCount === 1 ? 'word' : 'words'}`
        : `${longest.charCount} chars`;
      bits.push(`longest message ${descriptor} (${formatLocalDateTime(longest.timestamp)})`);
    }
    lines.push(`- ${bits.join(' · ')}`);
  }

  if (stats.topWords.length) {
    lines.push('\n## Frequently used words');
    const table = ['| Word | Count |', '| --- | ---: |'];
    for (const [word, count] of stats.topWords.slice(0, 10)) {
      table.push(`| ${word} | ${count} |`);
    }
    lines.push(...table);
  }

  if (stats.topEmojis.length) {
    lines.push('\n## Emoji energy');
    const emojiLine = stats.topEmojis.map(([emoji, count]) => `${emoji} × ${count}`).join(' · ');
    lines.push(emojiLine);
  }

  if (sampleCount > 0 && messages.length) {
    lines.push('\n## Representative moments');
    const step = Math.max(1, Math.floor(messages.length / sampleCount));
    for (let i = 0; i < sampleCount && i * step < messages.length; i += 1) {
      const message = messages[i * step];
      const date = formatLocalDateTime(message.timestamp);
      lines.push(`- ${date} · **${message.author}:** ${message.content.replace(/\n/g, ' ')}`);
    }
  }

  lines.push('\n---\n_Generated with the WhatsApp Chat Insights Dashboard._');

  return lines.join('\n');
}
