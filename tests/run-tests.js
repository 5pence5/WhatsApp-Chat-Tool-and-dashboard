import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { parseChat, computeStatistics, generateMarkdownSummary, filterMessagesByDate } from '../js/chatParser.js';
import { chooseChatFileCandidate } from '../js/chatFileSelector.js';
import { JSDOM } from 'jsdom';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const stopWords = new Set([
  'the', 'and', 'you', 'for', 'that', 'with', 'this', 'have', 'but', 'not', 'are', 'your', 'was', 'get', 'got', 'just', 'they',
  'them', 'what', 'when', 'from', 'there', 'their', 'would', 'could', 'about', 'will', 'cant', 'dont', 'didnt', 'im', 'its',
  'were', 'had', 'has', 'how', 'all', 'out', 'now', 'like', 'yeah', 'yes', 'she', 'his', 'her', 'who', 'him', 'our', 'one',
  'why', 'too', 'wasnt', 'havent', 'into', 'then', 'than', 'ill', 'ive', 'did', 'okay', 'ok', 'sure', 'well', 'also', 'more',
  'some', 'been', 'over', 'here', 'back', 'much', 'make', 'really', 'know', 'going', 'want', 'time', 'see', 'let', 'say',
  'good', 'thanks', 'thank', 'thats', 'doesnt', 'aint', 'u', 'ur', 'lol', 'omg', 'lmfao', 'lmao', 'haha', 'hahaha', 'http',
  'https', 'to', 'is', 'in', 'on', 'at', 'we', 'me', 'my', 'do', 'if', 'as', 'be', 'an', 'or', 'by', 'no', 'up', 'so', 'it',
  'he', 'ya', 'oh', 'hadnt', 'should', 'ive', 'theyll', 'theyd', 'theirs', 'ours', 'mine', 'of', 'can'
]);

async function loadExample() {
  const zipPath = path.resolve(__dirname, '..', 'test.zip');
  const buffer = await readFile(zipPath);
  const zip = await JSZip.loadAsync(buffer);
  const chatEntry = Object.values(zip.files).find((file) => file.name.endsWith('.txt'));
  if (!chatEntry) {
    throw new Error('Example archive does not contain a .txt file');
  }
  return chatEntry.async('string');
}

function extractWords(content = '') {
  return content
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .split(/\s+/)
    .map((word) => word.replace(/^'+|'+$/g, '').replace(/'/g, ''))
    .filter((word) => word.length > 1 && !stopWords.has(word));
}

async function main() {
  const rawText = await loadExample();
  const parseResult = parseChat(rawText);
  const { messages } = parseResult;
  if (!messages.length) {
    throw new Error('Parser failed to load messages from the example chat.');
  }

  const isMediaPlaceholder = (content = '') => {
    const lower = content.toLowerCase();
    return lower.includes('omitted') || lower.includes('<media') || lower.includes('image omitted') || lower.includes('video omitted');
  };

  if (!messages.some((message) => message.content.includes('ec8s61tkc7gzvk4cim6a'))) {
    throw new Error('Expected to find the generated WiFi password sample in the chat.');
  }

  const stats = computeStatistics(messages);
  if (stats.participants.length < 2) {
    throw new Error('Expected at least two participants in the example chat.');
  }

  if (!stats.longestMessageByParticipant) {
    throw new Error('Expected longest message metadata to be returned in statistics.');
  }

  for (const participant of stats.participants) {
    const record = stats.longestMessageByParticipant[participant];
    const best = messages
      .filter((message) => message.author === participant && message.type === 'message' && !isMediaPlaceholder(message.content))
      .reduce((currentBest, message) => {
        const candidateTrimmed = (message.content || '').trim();
        if (!candidateTrimmed) {
          return currentBest;
        }
        const candidateWords = candidateTrimmed.split(/\s+/).filter(Boolean).length;
        const candidateChars = candidateTrimmed.length;
        if (!currentBest) {
          return { message, candidateWords, candidateChars };
        }
        if (candidateWords > currentBest.candidateWords) {
          return { message, candidateWords, candidateChars };
        }
        if (candidateWords === currentBest.candidateWords && candidateChars > currentBest.candidateChars) {
          return { message, candidateWords, candidateChars };
        }
        return currentBest;
      }, null);

    if (!best) {
      if (record !== null && typeof record !== 'undefined') {
        throw new Error(`Participants without qualifying messages should not report longest message metadata for ${participant}.`);
      }
      continue;
    }

    if (!record) {
      throw new Error(`Missing longest message entry for ${participant}.`);
    }
    if (!(record.timestamp instanceof Date) || Number.isNaN(record.timestamp.getTime())) {
      throw new Error(`Longest message timestamp for ${participant} should be a valid Date.`);
    }

    const trimmed = (record.content || '').trim();
    const expectedWordCount = trimmed ? trimmed.split(/\s+/).filter(Boolean).length : 0;
    if (record.wordCount !== expectedWordCount) {
      throw new Error(`Word count for ${participant}'s longest message should match the trimmed content.`);
    }
    if (record.charCount !== trimmed.length) {
      throw new Error(`Character count for ${participant}'s longest message should match the trimmed content.`);
    }

    if (best.message.content !== record.content || best.message.timestamp.getTime() !== record.timestamp.getTime()) {
      throw new Error(`Longest message metadata for ${participant} should reference the most substantial message.`);
    }
  }

  const participantWordFrequencies = new Map();
  for (const message of messages) {
    if (message.type !== 'message') continue;
    if (isMediaPlaceholder(message.content)) continue;
    const words = extractWords(message.content || '');
    if (!words.length) continue;
    if (!participantWordFrequencies.has(message.author)) {
      participantWordFrequencies.set(message.author, new Map());
    }
    const authorMap = participantWordFrequencies.get(message.author);
    for (const word of words) {
      authorMap.set(word, (authorMap.get(word) || 0) + 1);
    }
  }

  if (!stats.topWordsByParticipant || typeof stats.topWordsByParticipant !== 'object') {
    throw new Error('Per-participant top word statistics should be returned.');
  }

  for (const participant of stats.participants) {
    const reported = stats.topWordsByParticipant[participant] || [];
    if (!Array.isArray(reported)) {
      throw new Error(`Top words for ${participant} should be an array.`);
    }

    const expectedEntries = Array.from(participantWordFrequencies.get(participant)?.entries() || [])
      .sort((a, b) => {
        if (a[1] === b[1]) {
          return a[0].localeCompare(b[0]);
        }
        return b[1] - a[1];
      });

    const expectedLength = Math.min(10, expectedEntries.length);
    if (reported.length !== expectedLength) {
      throw new Error(`Expected ${expectedLength} top words for ${participant}, received ${reported.length}.`);
    }

    for (let index = 0; index < reported.length; index += 1) {
      const [word, count] = reported[index];
      const [expectedWord, expectedCount] = expectedEntries[index];
      if (word !== expectedWord || count !== expectedCount) {
        throw new Error(`Unexpected top word for ${participant} at position ${index + 1}.`);
      }
    }

    if (expectedEntries.length > 10 && reported.length) {
      const [, lastCount] = reported[reported.length - 1];
      const [, nextCount] = expectedEntries[reported.length];
      if (nextCount > lastCount) {
        throw new Error(`Only the highest-frequency words should appear for ${participant}.`);
      }
    }
  }

  const mediaPlaceholderMessage = {
    timestamp: new Date(messages[0].timestamp.getTime() + 60000),
    author: messages[0].author,
    content: '<Media omitted>',
    type: 'message'
  };
  const statsWithMedia = computeStatistics([...messages, mediaPlaceholderMessage]);

  if (statsWithMedia.totalWords !== stats.totalWords) {
    throw new Error('Media placeholder messages should not change the total word count.');
  }

  const roundToTenth = (value) => Math.round(value * 10) / 10;

  const ensureAveragesMatchCounts = (currentStats) => {
    for (const participant of currentStats.participants) {
      const wordCount = currentStats.wordCountByParticipant[participant] || 0;
      const messageCount = currentStats.messageCountByParticipant[participant] || 0;
      const expectedAverage = messageCount ? roundToTenth(wordCount / messageCount) : 0;
      const reportedAverage = currentStats.averageWordsPerMessage?.[participant] ?? null;
      if (reportedAverage !== expectedAverage) {
        throw new Error(`Average words per message for ${participant} should be ${expectedAverage}, got ${reportedAverage}.`);
      }
    }

    const expectedOverall = currentStats.totalMessages
      ? roundToTenth(currentStats.totalWords / currentStats.totalMessages)
      : 0;
    if (currentStats.overallAverageWordsPerMessage !== expectedOverall) {
      throw new Error(`Overall average words per message should be ${expectedOverall}, got ${currentStats.overallAverageWordsPerMessage}.`);
    }
  };

  ensureAveragesMatchCounts(stats);
  ensureAveragesMatchCounts(statsWithMedia);

  const whitespaceMessages = [
    { timestamp: new Date(2024, 0, 1, 9, 0), author: 'Trimmer', content: 'Hello   ', type: 'message' },
    { timestamp: new Date(2024, 0, 1, 9, 1), author: 'Trimmer', content: '  spaced out   ', type: 'message' },
    { timestamp: new Date(2024, 0, 1, 9, 2), author: 'Trimmer', content: 'Line with newline\n\n', type: 'message' }
  ];

  const whitespaceStats = computeStatistics(whitespaceMessages);
  const trimmedTotal = whitespaceMessages.reduce((sum, message) => sum + (message.content || '').trim().length, 0);
  const rawTotal = whitespaceMessages.reduce((sum, message) => sum + (message.content || '').length, 0);
  const expectedTrimmedAverage = roundToTenth(trimmedTotal / whitespaceMessages.length);
  const expectedRawAverage = roundToTenth(rawTotal / whitespaceMessages.length);

  if (expectedTrimmedAverage === expectedRawAverage) {
    throw new Error('Whitespace fixture should produce different trimmed and raw averages.');
  }

  const reportedAverageLength = whitespaceStats.averageMessageLength.Trimmer;
  if (reportedAverageLength !== expectedTrimmedAverage) {
    throw new Error(`Average message length should ignore surrounding whitespace. Expected ${expectedTrimmedAverage}, got ${reportedAverageLength}.`);
  }

  for (const participant of stats.participants) {
    const before = stats.wordCountByParticipant[participant] || 0;
    const after = statsWithMedia.wordCountByParticipant[participant] || 0;
    if (before !== after) {
      throw new Error(`Media placeholder messages should not change the word count for ${participant}.`);
    }
    const beforeTop = JSON.stringify(stats.topWordsByParticipant?.[participant] || []);
    const afterTop = JSON.stringify(statsWithMedia.topWordsByParticipant?.[participant] || []);
    if (beforeTop !== afterTop) {
      throw new Error(`Media placeholder messages should not change the top words for ${participant}.`);
    }
  }

  const expectedParticipants = ['~Ieommq', 'Imbl'];
  for (const participant of expectedParticipants) {
    if (!stats.participants.includes(participant)) {
      throw new Error(`Expected participant ${participant} to be detected in the chat.`);
    }
  }

  if (stats.totalMessages !== 11) {
    throw new Error(`Example chat should contain 11 messages, found ${stats.totalMessages}.`);
  }

  if (stats.totalMessages <= 0) {
    throw new Error('Statistics should report at least one message.');
  }

  const markdown = generateMarkdownSummary({
    title: 'Example Chat Recap',
    messages,
    stats,
    sampleCount: 2
  });

  if (!markdown.includes('# Example Chat Recap')) {
    throw new Error('Markdown summary did not include the custom title.');
  }

  if (!markdown.includes('**Timeframe:** 2025-07-31 → 2025-07-31')) {
    throw new Error('Markdown summary should include the detected timeframe of the new sample chat.');
  }

  if (!markdown.includes('words/msg')) {
    throw new Error('Markdown summary should surface average words per message.');
  }

  const buildCandidatesFromZip = async (zipInstance) => {
    const buffer = await zipInstance.generateAsync({ type: 'uint8array' });
    const archive = await JSZip.loadAsync(buffer);
    const entries = [];
    await Promise.all(Object.values(archive.files).map(async (entry) => {
      if (entry.dir) return;
      const name = entry.name;
      const baseName = name.split('/').pop() || name;
      if (baseName.startsWith('._')) return;
      if (!baseName.toLowerCase().endsWith('.txt')) return;
      const data = await entry.async('uint8array');
      entries.push({
        name,
        path: name,
        baseName,
        size: data.length
      });
    }));
    return entries;
  };

  const targetedZip = new JSZip();
  targetedZip.file('WhatsApp Chat with Project.txt', 'Primary chat transcript\nLine 2\nLine 3');
  targetedZip.file('Quick note.txt', 'Short note');
  targetedZip.file('__MACOSX/._WhatsApp Chat with Project.txt', 'junk');

  const targetedCandidates = await buildCandidatesFromZip(targetedZip);
  const targetedSelection = chooseChatFileCandidate(targetedCandidates);
  if (targetedSelection.type !== 'selected' || targetedSelection.candidate.baseName !== 'WhatsApp Chat with Project.txt') {
    throw new Error('Heuristic selection should prefer the primary WhatsApp transcript.');
  }

  const ambiguousZip = new JSZip();
  ambiguousZip.file('WhatsApp Chat with Alice.txt', 'Alpha message');
  ambiguousZip.file('WhatsApp Chat with Bob.txt', 'Alpha message');
  ambiguousZip.file('Readme.txt', 'General info');

  const ambiguousCandidates = await buildCandidatesFromZip(ambiguousZip);
  const ambiguousSelection = chooseChatFileCandidate(ambiguousCandidates);
  if (ambiguousSelection.type !== 'ambiguous') {
    throw new Error('Equal candidates should require a manual selection.');
  }

  const ambiguousNames = ambiguousSelection.candidates.map((candidate) => candidate.baseName).sort();
  if (ambiguousNames.length !== 2
    || ambiguousNames[0] !== 'WhatsApp Chat with Alice.txt'
    || ambiguousNames[1] !== 'WhatsApp Chat with Bob.txt') {
    throw new Error('Ambiguous selection should surface each tied WhatsApp transcript.');
  }

  const ambiguousChat = [
    '02/03/2024, 09:15 - Alice: Planning session',
    '03/03/2024, 10:05 - Bob: Following up',
    '04/03/2024, 11:20 - Alice: Notes shared',
    '05/03/2024, 12:45 - Bob: Looks good',
    '06/03/2024, 13:00 - Alice: Ready for launch',
    '07/03/2024, 14:10 - Bob: Countdown continues',
    '08/03/2024, 15:25 - Alice: Final checks',
    '09/03/2024, 16:40 - Bob: Almost done',
    '10/03/2024, 17:55 - Alice: Deploying now',
    '11/03/2024, 18:30 - Bob: Deployment succeeded',
    '12/03/2024, 19:15 - Alice: Retrospective tomorrow'
  ].join('\n');

  const ambiguousResult = parseChat(ambiguousChat);
  if (!ambiguousResult.ambiguous) {
    throw new Error('Expected ambiguous chat detection for the custom sample.');
  }

  if (ambiguousResult.dateFormat !== 'DMY') {
    throw new Error('Ambiguous sample should default to day/month/year interpretation.');
  }

  if (!ambiguousResult.messages.length) {
    throw new Error('Ambiguous sample should still yield parsed messages.');
  }

  const firstAmbiguousMonth = ambiguousResult.messages[0].timestamp.getUTCMonth();
  if (firstAmbiguousMonth !== 2) {
    throw new Error('DMY interpretation should treat 02/03 as March 2nd (month index 2).');
  }

  const alternativeResult = parseChat(ambiguousChat, { dateFormat: 'MDY' });
  if (!alternativeResult.usedOverride) {
    throw new Error('Override flag should be set when forcing a date format.');
  }

  const alternativeMonth = alternativeResult.messages[0].timestamp.getUTCMonth();
  if (alternativeMonth !== 1) {
    throw new Error('MDY interpretation should treat 02/03 as February 3rd (month index 1).');
  }

  const dmySpan = ambiguousResult.messages.at(-1).timestamp.getTime() - ambiguousResult.messages[0].timestamp.getTime();
  const mdySpan = alternativeResult.messages.at(-1).timestamp.getTime() - alternativeResult.messages[0].timestamp.getTime();
  if (dmySpan <= 0 || mdySpan <= 0) {
    throw new Error('Span calculations should yield positive values for both interpretations.');
  }

  if (dmySpan >= mdySpan) {
    throw new Error('DMY interpretation should result in a smaller overall timespan than MDY for the ambiguous sample.');
  }

  const replyGapMessages = [
    { timestamp: new Date(2024, 0, 1, 21, 0), author: 'Alice', content: 'Evening check-in', type: 'message' },
    { timestamp: new Date(2024, 0, 1, 21, 10), author: 'Bob', content: 'All good!', type: 'message' },
    { timestamp: new Date(2024, 0, 1, 22, 0), author: 'Alice', content: 'Heading to sleep', type: 'message' },
    { timestamp: new Date(2024, 0, 2, 6, 30), author: 'Bob', content: 'Morning update', type: 'message' }
  ];

  const baselineResponse = computeStatistics(replyGapMessages);
  const baselineMetrics = baselineResponse.responseTimes.Bob;
  if (!baselineMetrics || typeof baselineMetrics.averageMinutes !== 'number' || typeof baselineMetrics.medianMinutes !== 'number') {
    throw new Error('Expected Bob to have average and median response times in the baseline statistics.');
  }

  if (baselineMetrics.averageMinutes <= 200 || baselineMetrics.medianMinutes <= 200) {
    throw new Error('Expected long overnight gaps to skew averages and medians when no cutoff is applied.');
  }

  const trimmedResponse = computeStatistics(replyGapMessages, { responseGapMinutes: 60 });
  const trimmedMetrics = trimmedResponse.responseTimes.Bob;
  if (!trimmedMetrics || typeof trimmedMetrics.averageMinutes !== 'number' || typeof trimmedMetrics.medianMinutes !== 'number') {
    throw new Error('Expected Bob to retain average and median metrics after applying a cutoff.');
  }

  if (Math.abs(trimmedMetrics.averageMinutes - 10) > 0.01 || Math.abs(trimmedMetrics.medianMinutes - 10) > 0.01) {
    throw new Error('Trimming long gaps should preserve the short 10-minute reply in both average and median calculations.');
  }

  if (trimmedResponse.responseGapMinutes !== 60) {
    throw new Error('Response gap setting should be exposed in the statistics payload.');
  }

  if (trimmedResponse.responseGapOvernightBufferMinutes !== 0) {
    throw new Error('Overnight buffer should default to zero when not enabled.');
  }

  const bufferedResponse = computeStatistics(replyGapMessages, {
    responseGapMinutes: 60,
    overnightBufferMinutes: 480
  });

  const bufferedMetrics = bufferedResponse.responseTimes.Bob;
  if (!bufferedMetrics || typeof bufferedMetrics.averageMinutes !== 'number' || typeof bufferedMetrics.medianMinutes !== 'number') {
    throw new Error('Expected Bob to have average and median metrics when overnight buffer is applied.');
  }

  if (Math.abs(bufferedMetrics.averageMinutes - baselineMetrics.averageMinutes) > 0.01
    || Math.abs(bufferedMetrics.medianMinutes - baselineMetrics.medianMinutes) > 0.01) {
    throw new Error('Overnight buffer should retain overnight replies within the extended allowance for both average and median.');
  }

  if (bufferedResponse.responseGapOvernightBufferMinutes !== 480) {
    throw new Error('Expected overnight buffer setting to be surfaced in the statistics payload.');
  }

  const medianTestMessages = [
    { timestamp: new Date(2024, 0, 1, 10, 0), author: 'Charlie', content: 'Ping', type: 'message' },
    { timestamp: new Date(2024, 0, 1, 10, 5), author: 'Dana', content: 'Reply 1', type: 'message' },
    { timestamp: new Date(2024, 0, 1, 10, 9), author: 'Charlie', content: 'Follow up', type: 'message' },
    { timestamp: new Date(2024, 0, 1, 10, 15), author: 'Dana', content: 'Reply 2', type: 'message' },
    { timestamp: new Date(2024, 0, 1, 10, 18), author: 'Charlie', content: 'Check in', type: 'message' },
    { timestamp: new Date(2024, 0, 1, 10, 19), author: 'Dana', content: 'Reply 3', type: 'message' },
    { timestamp: new Date(2024, 0, 1, 10, 25), author: 'Charlie', content: 'Wrap up', type: 'message' }
  ];

  const medianStats = computeStatistics(medianTestMessages);
  const charlieMetrics = medianStats.responseTimes.Charlie;
  const danaMetrics = medianStats.responseTimes.Dana;

  if (!charlieMetrics || charlieMetrics.samples !== 3) {
    throw new Error('Expected Charlie to report three qualifying gaps.');
  }
  if (!danaMetrics || danaMetrics.samples !== 3) {
    throw new Error('Expected Dana to report three qualifying gaps.');
  }

  if (Math.abs(charlieMetrics.medianMinutes - 4) > 0.01 || Math.abs(charlieMetrics.averageMinutes - (13 / 3)) > 0.01) {
    throw new Error('Charlie median/average reply times should reflect odd-sized samples.');
  }
  if (Math.abs(danaMetrics.medianMinutes - 5) > 0.01 || Math.abs(danaMetrics.averageMinutes - 4) > 0.01) {
    throw new Error('Dana median/average reply times should reflect odd-sized samples.');
  }

  const trimmedMedianStats = computeStatistics(medianTestMessages, { responseGapMinutes: 5 });
  const trimmedCharlie = trimmedMedianStats.responseTimes.Charlie;
  const trimmedDana = trimmedMedianStats.responseTimes.Dana;

  if (!trimmedCharlie || trimmedCharlie.samples !== 2) {
    throw new Error('Charlie should retain two qualifying gaps after applying a cutoff.');
  }
  if (!trimmedDana || trimmedDana.samples !== 2) {
    throw new Error('Dana should retain two qualifying gaps after applying a cutoff.');
  }

  if (Math.abs(trimmedCharlie.medianMinutes - 3.5) > 0.01 || Math.abs(trimmedCharlie.averageMinutes - 3.5) > 0.01) {
    throw new Error('Charlie median/average should reflect even-sized samples when trimmed.');
  }
  if (Math.abs(trimmedDana.medianMinutes - 3) > 0.01 || Math.abs(trimmedDana.averageMinutes - 3) > 0.01) {
    throw new Error('Dana median/average should reflect even-sized samples when trimmed.');
  }

  const soloMessages = [
    { timestamp: new Date(2024, 0, 1, 9, 0), author: 'Solo', content: 'Hello there', type: 'message' },
    { timestamp: new Date(2024, 0, 1, 9, 5), author: 'Solo', content: 'Still here', type: 'message' }
  ];
  const soloStats = computeStatistics(soloMessages);
  if (soloStats.responseTimes.Solo) {
    throw new Error('Participants without alternating replies should not report response metrics.');
  }

  const filterableMessages = [
    { timestamp: new Date(2024, 4, 1, 9, 0), author: 'Alpha', content: 'Falcon zephyr', type: 'message' },
    { timestamp: new Date(2024, 4, 2, 9, 30), author: 'Alpha', content: 'Quartz galaxy nebula', type: 'message' },
    { timestamp: new Date(2024, 4, 2, 10, 0), author: 'Beta', content: 'Meteor aurora', type: 'message' }
  ];

  const filterStats = computeStatistics(filterableMessages);
  ensureAveragesMatchCounts(filterStats);

  const filteredSubset = filterMessagesByDate(filterableMessages, '2024-05-02', '2024-05-02');
  const filteredStats = computeStatistics(filteredSubset);
  ensureAveragesMatchCounts(filteredStats);

  const alphaAverage = filteredStats.averageWordsPerMessage.Alpha;
  if (alphaAverage !== roundToTenth(3 / 1)) {
    throw new Error('Filtered averages should recalculate when narrowing the date range.');
  }

  const dom = new JSDOM(`<!DOCTYPE html>
    <html>
      <body>
        <input id="chat-file" />
        <div id="file-helper"></div>
        <div id="load-status"></div>
        <input id="start-date" />
        <input id="end-date" />
        <button id="apply-range"></button>
        <button id="reset-range"></button>
        <div id="summary-cards"></div>
        <ul id="top-words"></ul>
        <select id="participant-word-select"></select>
        <div id="participant-word-selector"></div>
        <div id="participant-word-summary"></div>
        <ul id="participant-top-words"></ul>
        <ul id="top-emojis"></ul>
        <ul id="insight-list"></ul>
        <ul id="response-times"></ul>
        <ul id="longest-messages"></ul>
        <input id="response-gap-limit" />
        <input id="response-overnight-toggle" type="checkbox" />
        <input id="response-overnight-minutes" />
        <div id="response-cutoff-note"></div>
        <input id="md-title" />
        <input id="sample-count" />
        <button id="generate-md"></button>
        <textarea id="md-preview"></textarea>
        <canvas id="participants-chart"></canvas>
        <canvas id="hourly-chart"></canvas>
        <canvas id="words-chart"></canvas>
      </body>
    </html>`, { url: 'http://localhost' });

  const { window } = dom;
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.HTMLInputElement = window.HTMLInputElement;
  globalThis.Event = window.Event;
  globalThis.CustomEvent = window.CustomEvent;
  globalThis.Node = window.Node;
  globalThis.Blob = window.Blob;
  globalThis.getComputedStyle = window.getComputedStyle.bind(window);
  globalThis.URL = window.URL;

  class StubChart {
    constructor() {}
    destroy() {}
  }

  globalThis.Chart = StubChart;
  window.Chart = StubChart;

  const { updateResponseTimesList, buildInsights } = await import('../js/app.js');

  const maliciousName = 'Eve <script>alert(1)</script>';
  const uiStats = {
    participants: [maliciousName],
    responseTimes: {
      [maliciousName]: {
        averageMinutes: 4.5,
        medianMinutes: 3.2,
        samples: 5
      }
    },
    totalMessages: 1,
    responseGapMinutes: null,
    responseGapOvernightBufferMinutes: 0,
    busiestDay: null,
    busiestHour: null,
    longestStreak: 0,
    longestStreakRange: null
  };

  updateResponseTimesList(uiStats);
  buildInsights(uiStats);

  const responseHtml = document.getElementById('response-times').innerHTML;
  if (responseHtml.includes('<script>alert')) {
    throw new Error('Response times list should escape participant-provided HTML.');
  }
  if (!responseHtml.includes('&lt;script&gt;alert(1)&lt;/script&gt;')) {
    throw new Error('Response times list should render escaped participant names.');
  }

  const insightHtml = document.getElementById('insight-list').innerHTML;
  if (insightHtml.includes('<script>alert')) {
    throw new Error('Insights should escape participant-provided HTML.');
  }
  if (!insightHtml.includes('&lt;script&gt;alert(1)&lt;/script&gt;')) {
    throw new Error('Insights should render escaped participant names.');
  }

  console.log('Parsed messages:', messages.length);
  console.log('Participants detected:', stats.participants.join(', '));
  console.log('Top word sample:', stats.topWords.slice(0, 3));
  console.log('Markdown preview snippet:', markdown.split('\n').slice(0, 5).join('\n'));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
