import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { parseChat, computeStatistics, generateMarkdownSummary, generateMarkdownTranscript } from '../js/chatParser.js';

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
  const messages = parseChat(rawText);
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

  const transcript = generateMarkdownTranscript({
    title: 'Example Chat Transcript',
    messages,
    includeSystemMessages: false
  });

  if (!transcript.includes('# Example Chat Transcript')) {
    throw new Error('Transcript export should honour the provided title.');
  }

  if (!transcript.includes('```')) {
    throw new Error('Transcript export should include a fenced code block for the conversation.');
  }

  if (!transcript.includes('[2025-07-31')) {
    throw new Error('Transcript export should include message timestamps.');
  }

  const transcriptWithMeta = generateMarkdownTranscript({
    title: 'Example Chat Transcript',
    messages,
    includeSystemMessages: true,
    startDate: '2025-07-31',
    endDate: '2025-07-31'
  });

  if (!transcriptWithMeta.includes('**Timeframe:** 2025-07-31 → 2025-07-31')) {
    throw new Error('Transcript export should surface the supplied date range.');
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
