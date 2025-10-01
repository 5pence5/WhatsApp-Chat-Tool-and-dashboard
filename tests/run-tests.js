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
  const baselineBob = baselineResponse.responseTimes.Bob;
  if (!baselineBob || typeof baselineBob.averageMinutes !== 'number' || typeof baselineBob.medianMinutes !== 'number') {
    throw new Error('Expected Bob to have average and median response times in the baseline statistics.');
  }

  if (baselineBob.averageMinutes <= 200) {
    throw new Error('Expected long overnight gaps to skew averages when no cutoff is applied.');
  }

  const trimmedResponse = computeStatistics(replyGapMessages, { responseGapMinutes: 60 });
  const trimmedBob = trimmedResponse.responseTimes.Bob;
  if (!trimmedBob || typeof trimmedBob.averageMinutes !== 'number' || typeof trimmedBob.medianMinutes !== 'number') {
    throw new Error('Expected Bob to retain at least one qualifying response gap.');
  }

  if (Math.abs(trimmedBob.averageMinutes - 10) > 0.01 || Math.abs(trimmedBob.medianMinutes - 10) > 0.01) {
    throw new Error('Trimming long gaps should preserve the short 10-minute reply for both average and median.');
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

  const bufferedBob = bufferedResponse.responseTimes.Bob;
  if (!bufferedBob || typeof bufferedBob.averageMinutes !== 'number' || typeof bufferedBob.medianMinutes !== 'number') {
    throw new Error('Expected Bob to have an average when overnight buffer is applied.');
  }

  if (Math.abs(bufferedBob.averageMinutes - baselineBob.averageMinutes) > 0.01
    || Math.abs(bufferedBob.medianMinutes - baselineBob.medianMinutes) > 0.01) {
    throw new Error('Overnight buffer should retain overnight replies within the extended allowance.');
  }

  if (bufferedResponse.responseGapOvernightBufferMinutes !== 480) {
    throw new Error('Expected overnight buffer setting to be surfaced in the statistics payload.');
  }

  const strictResponse = computeStatistics(replyGapMessages, { responseGapMinutes: 5 });
  if (strictResponse.responseTimes.Bob) {
    throw new Error('No qualifying gaps should leave response statistics empty for the participant.');
  }

  const medianTestMessages = [
    { timestamp: new Date(2024, 0, 1, 8, 0), author: 'Alice', content: 'Start', type: 'message' },
    { timestamp: new Date(2024, 0, 1, 8, 5), author: 'Bob', content: 'Reply 1', type: 'message' },
    { timestamp: new Date(2024, 0, 1, 8, 15), author: 'Alice', content: 'Follow up', type: 'message' },
    { timestamp: new Date(2024, 0, 1, 8, 25), author: 'Bob', content: 'Reply 2', type: 'message' },
    { timestamp: new Date(2024, 0, 1, 8, 50), author: 'Alice', content: 'Another update', type: 'message' },
    { timestamp: new Date(2024, 0, 1, 9, 5), author: 'Bob', content: 'Reply 3', type: 'message' }
  ];

  const medianStats = computeStatistics(medianTestMessages);
  const bobStats = medianStats.responseTimes.Bob;
  if (!bobStats || Math.abs(bobStats.averageMinutes - 10) > 0.01 || Math.abs(bobStats.medianMinutes - 10) > 0.01 || bobStats.samples !== 3) {
    throw new Error('Expected Bob to have three samples with both average and median at 10 minutes.');
  }

  const aliceStats = medianStats.responseTimes.Alice;
  if (!aliceStats || Math.abs(aliceStats.averageMinutes - 17.5) > 0.01 || Math.abs(aliceStats.medianMinutes - 17.5) > 0.01 || aliceStats.samples !== 2) {
    throw new Error('Expected Alice to have two samples with both average and median at 17.5 minutes.');
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
