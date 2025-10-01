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
  for (const line of lines) {
    const header = matchMessageHeader(line);
    if (header) {
      const first = parseInt(header.day, 10);
      const second = parseInt(header.month, 10);
      if (first > 12) return 'DMY';
      if (second > 12) return 'MDY';
    }
  }
  return 'DMY';
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

  return new Date(Date.UTC(y, m - 1, d, hours, minutes, seconds));
}

function normaliseAuthor(author) {
  if (!author) return 'System';
  return author.replace(/^"|"$/g, '').trim();
}

export function parseChat(rawText) {
  if (!rawText) return [];
  const text = rawText.replace(/\uFEFF/g, '');
  const lines = text.split(/\r?\n/);
  const format = determineDateFormat(lines);

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

  return messages.filter((msg) => !Number.isNaN(msg.timestamp.getTime()));
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

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

export function computeStatistics(messages) {
  if (!messages.length) {
    return {
      totalMessages: 0,
      totalWords: 0,
      participants: [],
      messageCountByParticipant: {},
      wordCountByParticipant: {},
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
      responseTimeDetails: {},
      overallAverageResponseMinutes: null,
      overallMedianResponseMinutes: null,
      fastestResponder: null,
      slowestResponder: null
    };
  }

  const participantsSet = new Set();
  const messageCountByParticipant = {};
  const wordCountByParticipant = {};
  const totalWordsByParticipant = {};
  const messagesByDate = new Map();
  const messagesByHour = new Array(24).fill(0);
  const words = [];
  const emojiCounts = new Map();
  const responseTracking = {};
  const responseTimes = {};
  const responseTimeDetails = {};
  const overallResponseDeltas = [];

  let totalMessages = 0;
  let totalWords = 0;
  let mediaCount = 0;
  let systemCount = 0;

  const sortedMessages = [...messages].sort((a, b) => a.timestamp - b.timestamp);

  let previousMessage = null;

  for (const message of sortedMessages) {
    const dateKey = message.timestamp.toISOString().slice(0, 10);
    messagesByDate.set(dateKey, (messagesByDate.get(dateKey) || 0) + 1);
    messagesByHour[message.timestamp.getUTCHours()] += 1;

    if (message.type === 'system') {
      systemCount += 1;
      previousMessage = message;
      continue;
    }

    const author = message.author;
    participantsSet.add(author);
    messageCountByParticipant[author] = (messageCountByParticipant[author] || 0) + 1;
    const wordList = extractWords(message.content);
    wordCountByParticipant[author] = (wordCountByParticipant[author] || 0) + wordList.length;
    totalWordsByParticipant[author] = (totalWordsByParticipant[author] || 0) + message.content.length;

    totalMessages += 1;
    totalWords += wordList.length;

    if (isMediaMessage(message.content)) {
      mediaCount += 1;
    } else {
      words.push(...wordList);
      const emojis = extractEmojis(message.content);
      for (const emoji of emojis) {
        emojiCounts.set(emoji, (emojiCounts.get(emoji) || 0) + 1);
      }
    }

    if (previousMessage && previousMessage.type === 'message' && previousMessage.author !== author) {
      const delta = (message.timestamp - previousMessage.timestamp) / 60000;
      if (!responseTracking[author]) {
        responseTracking[author] = [];
      }
      responseTracking[author].push(delta);
      overallResponseDeltas.push(delta);
    }

    previousMessage = message;
  }

  const participants = Array.from(participantsSet).sort((a, b) => (messageCountByParticipant[b] || 0) - (messageCountByParticipant[a] || 0));

  for (const [author, deltas] of Object.entries(responseTracking)) {
    if (deltas.length) {
      const avg = deltas.reduce((acc, value) => acc + value, 0) / deltas.length;
      const med = median(deltas);
      const roundedAverage = round(avg, 2);
      const roundedMedian = round(med, 2);
      responseTimes[author] = roundedAverage;
      responseTimeDetails[author] = {
        averageMinutes: roundedAverage,
        medianMinutes: roundedMedian,
        samples: deltas.length
      };
    }
  }

  let overallAverageResponseMinutes = null;
  let overallMedianResponseMinutes = null;
  if (overallResponseDeltas.length) {
    const avg = overallResponseDeltas.reduce((acc, value) => acc + value, 0) / overallResponseDeltas.length;
    overallAverageResponseMinutes = round(avg, 2);
    overallMedianResponseMinutes = round(median(overallResponseDeltas), 2);
  }

  let fastestResponder = null;
  let slowestResponder = null;
  const responderEntries = Object.entries(responseTimeDetails);
  if (responderEntries.length) {
    const sorted = responderEntries.sort((a, b) => a[1].averageMinutes - b[1].averageMinutes);
    const [fastestName, fastestStats] = sorted[0];
    const [slowestName, slowestStats] = sorted[sorted.length - 1];
    fastestResponder = {
      participant: fastestName,
      averageMinutes: fastestStats.averageMinutes,
      medianMinutes: fastestStats.medianMinutes
    };
    slowestResponder = {
      participant: slowestName,
      averageMinutes: slowestStats.averageMinutes,
      medianMinutes: slowestStats.medianMinutes
    };
  }

  const topWords = Object.entries(words.reduce((acc, word) => {
    acc[word] = (acc[word] || 0) + 1;
    return acc;
  }, {})).sort((a, b) => b[1] - a[1]).slice(0, 15);

  const topEmojis = Array.from(emojiCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10);

  const averageMessageLength = {};
  for (const participant of participants) {
    const count = messageCountByParticipant[participant] || 0;
    averageMessageLength[participant] = count ? round(totalWordsByParticipant[participant] / count, 1) : 0;
  }

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
    participants,
    messageCountByParticipant,
    wordCountByParticipant,
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
    responseTimeDetails,
    overallAverageResponseMinutes,
    overallMedianResponseMinutes,
    fastestResponder,
    slowestResponder
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

export function filterMessagesByDate(messages, startDate, endDate) {
  if (!startDate && !endDate) return [...messages];
  const start = startDate ? new Date(startDate) : null;
  const end = endDate ? new Date(endDate) : null;

  return messages.filter((message) => {
    const ts = message.timestamp;
    if (start && ts < new Date(start.getTime())) return false;
    if (end) {
      const endOfDay = new Date(end.getTime());
      endOfDay.setUTCHours(23, 59, 59, 999);
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
      ? `**Timeframe:** ${stats.firstMessageDate.toISOString().slice(0, 10)} → ${stats.lastMessageDate.toISOString().slice(0, 10)}`
      : null;
  if (dateLine) lines.push(dateLine);

  lines.push('');
  lines.push(`- **Messages analysed:** ${stats.totalMessages.toLocaleString()}`);
  lines.push(`- **Unique participants:** ${stats.participants.length}`);
  if (stats.mediaCount) {
    lines.push(`- **Media shared:** ${stats.mediaCount}`);
  }
  if (stats.topWords.length) {
    lines.push(`- **Top themes:** ${stats.topWords.slice(0, 5).map(([word]) => `\`${word}\``).join(', ')}`);
  }
  if (stats.longestStreak > 1 && stats.longestStreakRange) {
    lines.push(`- **Longest daily streak:** ${stats.longestStreak} days (${stats.longestStreakRange.start} → ${stats.longestStreakRange.end})`);
  }
  if (stats.overallAverageResponseMinutes !== null) {
    lines.push(`- **Average response time:** ${stats.overallAverageResponseMinutes} minutes (median ${stats.overallMedianResponseMinutes} minutes)`);
  }
  if (stats.fastestResponder) {
    lines.push(`- **Fastest responder:** ${stats.fastestResponder.participant} (~${stats.fastestResponder.averageMinutes} min avg)`);
  }
  if (stats.slowestResponder && stats.fastestResponder && stats.slowestResponder.participant !== stats.fastestResponder.participant) {
    lines.push(`- **Slowest responder:** ${stats.slowestResponder.participant} (~${stats.slowestResponder.averageMinutes} min avg)`);
  }

  lines.push('\n## Participation');
  for (const participant of stats.participants) {
    const count = stats.messageCountByParticipant[participant];
    const words = stats.wordCountByParticipant[participant];
    const avgLength = stats.averageMessageLength[participant];
    const response = stats.responseTimes[participant];
    const bits = [`${participant}: **${count.toLocaleString()}** messages`];
    if (words) bits.push(`${words.toLocaleString()} words`);
    if (avgLength) bits.push(`avg length ${avgLength} chars`);
    if (response !== undefined) bits.push(`average response ≈ ${response} min`);
    lines.push(`- ${bits.join(' · ')}`);
  }

  const responseEntries = Object.entries(stats.responseTimeDetails || {});
  if (responseEntries.length) {
    lines.push('\n## Responsiveness');
    const table = ['| Participant | Avg (min) | Median (min) | Samples |', '| --- | ---: | ---: | ---: |'];
    for (const [participant, detail] of responseEntries.sort((a, b) => a[1].averageMinutes - b[1].averageMinutes)) {
      table.push(`| ${participant} | ${detail.averageMinutes} | ${detail.medianMinutes} | ${detail.samples} |`);
    }
    lines.push(...table);
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
      const date = message.timestamp.toISOString().replace('T', ' ').slice(0, 16);
      lines.push(`- ${date} · **${message.author}:** ${message.content.replace(/\n/g, ' ')}`);
    }
  }

  lines.push('\n---\n_Generated with the WhatsApp Chat Insights Dashboard._');

  return lines.join('\n');
}
