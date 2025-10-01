import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { parseChat, computeStatistics, generateMarkdownSummary } from '../js/chatParser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function loadExample() {
  const zipPath = path.resolve(__dirname, '..', 'Example  WhatsApp Chat - Demosthenes Caldis 1.zip');
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

  const stats = computeStatistics(messages);
  if (stats.participants.length < 2) {
    throw new Error('Expected at least two participants in the example chat.');
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

  console.log('Parsed messages:', messages.length);
  console.log('Participants detected:', stats.participants.join(', '));
  console.log('Top word sample:', stats.topWords.slice(0, 3));
  console.log('Markdown preview snippet:', markdown.split('\n').slice(0, 5).join('\n'));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
