import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { parseChat, computeStatistics, generateMarkdownSummary } from '../js/chatParser.js';

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

  if (!messages.some((message) => message.content.includes('ec8s61tkc7gzvk4cim6a'))) {
    throw new Error('Expected to find the generated WiFi password sample in the chat.');
  }

  const stats = computeStatistics(messages);
  if (stats.participants.length < 2) {
    throw new Error('Expected at least two participants in the example chat.');
  }

  const emptyStats = computeStatistics([]);
  if (Object.keys(emptyStats.topWordsByParticipant || {}).length !== 0) {
    throw new Error('Empty statistics should expose an empty topWordsByParticipant map.');
  }

  if (!stats.topWordsByParticipant || typeof stats.topWordsByParticipant !== 'object') {
    throw new Error('Statistics should expose per-participant top word breakdowns.');
  }

  for (const participant of stats.participants) {
    const entries = stats.topWordsByParticipant[participant];
    if (!Array.isArray(entries)) {
      throw new Error(`Expected top word entries for ${participant} to be an array.`);
    }
    if (entries.length > 10) {
      throw new Error(`Top word list for ${participant} should be limited to 10 items.`);
    }
    for (let i = 1; i < entries.length; i += 1) {
      if (entries[i][1] > entries[i - 1][1]) {
        throw new Error(`Top words for ${participant} should be sorted in descending frequency.`);
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

  const breakdownMessages = [
    { timestamp: new Date(2024, 0, 1, 0, 0), author: 'Ann', content: 'alpha alpha beta gamma', type: 'message' },
    { timestamp: new Date(2024, 0, 1, 0, 1), author: 'Bob', content: 'delta epsilon delta', type: 'message' },
    { timestamp: new Date(2024, 0, 1, 0, 2), author: 'Ann', content: 'beta gamma gamma', type: 'message' }
  ];

  const breakdownStats = computeStatistics(breakdownMessages);
  const annBreakdown = breakdownStats.topWordsByParticipant.Ann;
  if (!annBreakdown || annBreakdown.length < 3) {
    throw new Error('Expected Ann to have at least three tracked words.');
  }
  if (annBreakdown[0][0] !== 'gamma' || annBreakdown[0][1] !== 3) {
    throw new Error('Ann’s most common word should be gamma with three uses.');
  }
  if (annBreakdown[1][0] !== 'alpha' || annBreakdown[1][1] !== 2) {
    throw new Error('Ann’s second entry should be alpha with two uses.');
  }
  if (annBreakdown[2][0] !== 'beta' || annBreakdown[2][1] !== 2) {
    throw new Error('Ann’s third entry should be beta with two uses.');
  }

  const bobBreakdown = breakdownStats.topWordsByParticipant.Bob;
  if (!bobBreakdown || bobBreakdown.length !== 2) {
    throw new Error('Expected Bob to have exactly two tracked words.');
  }
  if (bobBreakdown[0][0] !== 'delta' || bobBreakdown[0][1] !== 2) {
    throw new Error('Bob’s top word should be delta with two uses.');
  }
  if (bobBreakdown[1][0] !== 'epsilon' || bobBreakdown[1][1] !== 1) {
    throw new Error('Bob’s second word should be epsilon with one use.');
  }

  const overflowWords = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'iota', 'kappa', 'lambda', 'mu'];
  const overflowMessages = overflowWords.map((word, index) => ({
    timestamp: new Date(2024, 0, 2, 0, index),
    author: 'Overflow',
    content: `${word} ${word}`,
    type: 'message'
  }));

  const overflowStats = computeStatistics(overflowMessages);
  const overflowBreakdown = overflowStats.topWordsByParticipant.Overflow;
  if (!overflowBreakdown || overflowBreakdown.length !== 10) {
    throw new Error('Overflow participant should only surface the top 10 words.');
  }
  if (!overflowBreakdown.every(([, count]) => count === 2)) {
    throw new Error('Overflow breakdown should retain the recorded counts for each word.');
  }
  if (overflowBreakdown.some(([word]) => word === 'theta' || word === 'zeta')) {
    throw new Error('Overflow breakdown should omit words outside the top 10.');
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
