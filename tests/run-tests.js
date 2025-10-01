import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { parseChat, computeStatistics, generateMarkdownSummary, filterMessagesByDate } from '../js/chatParser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

  for (const participant of stats.participants) {
    const before = stats.wordCountByParticipant[participant] || 0;
    const after = statsWithMedia.wordCountByParticipant[participant] || 0;
    if (before !== after) {
      throw new Error(`Media placeholder messages should not change the word count for ${participant}.`);
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
  if (typeof baselineResponse.responseTimes.Bob !== 'number') {
    throw new Error('Expected Bob to have an average response time in the baseline statistics.');
  }

  if (baselineResponse.responseTimes.Bob <= 200) {
    throw new Error('Expected long overnight gaps to skew averages when no cutoff is applied.');
  }

  const trimmedResponse = computeStatistics(replyGapMessages, { responseGapMinutes: 60 });
  if (typeof trimmedResponse.responseTimes.Bob !== 'number') {
    throw new Error('Expected Bob to retain at least one qualifying response gap.');
  }

  if (Math.abs(trimmedResponse.responseTimes.Bob - 10) > 0.01) {
    throw new Error('Trimming long gaps should preserve the short 10-minute reply.');
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

  if (typeof bufferedResponse.responseTimes.Bob !== 'number') {
    throw new Error('Expected Bob to have an average when overnight buffer is applied.');
  }

  if (Math.abs(bufferedResponse.responseTimes.Bob - baselineResponse.responseTimes.Bob) > 0.01) {
    throw new Error('Overnight buffer should retain overnight replies within the extended allowance.');
  }

  if (bufferedResponse.responseGapOvernightBufferMinutes !== 480) {
    throw new Error('Expected overnight buffer setting to be surfaced in the statistics payload.');
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

  console.log('Parsed messages:', messages.length);
  console.log('Participants detected:', stats.participants.join(', '));
  console.log('Top word sample:', stats.topWords.slice(0, 3));
  console.log('Markdown preview snippet:', markdown.split('\n').slice(0, 5).join('\n'));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
