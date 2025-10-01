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

  console.log('Parsed messages:', messages.length);
  console.log('Participants detected:', stats.participants.join(', '));
  console.log('Top word sample:', stats.topWords.slice(0, 3));
  console.log('Markdown preview snippet:', markdown.split('\n').slice(0, 5).join('\n'));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
