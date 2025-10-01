import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {
  parseChat,
  computeStatistics,
  generateMarkdownSummary,
  filterMessagesByDate
} from '../js/chatParser.js';

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

const rawText = await loadExample();
const messages = parseChat(rawText);
const stats = computeStatistics(messages);

test('parseChat extracts the sample conversation', () => {
  assert.equal(messages.length, 11);
  assert.ok(messages.every((message) => message.timestamp instanceof Date));
  assert.equal(messages[0].author, '~Ieommq');
  assert.ok(messages.some((message) => message.content.includes('ec8s61tkc7gzvk4cim6a')));
  assert.match(messages[2].content, /This message was edited/);
});

test('computeStatistics summarises the conversation accurately', () => {
  assert.equal(stats.totalMessages, 11);
  assert.equal(stats.totalWords, 43);
  assert.deepStrictEqual(stats.participants, ['~Ieommq', 'Imbl']);
  assert.deepStrictEqual(stats.messageCountByParticipant, { '~Ieommq': 7, Imbl: 4 });
  assert.deepStrictEqual(stats.wordCountByParticipant, { '~Ieommq': 27, Imbl: 16 });
  assert.equal(stats.messagesByHour[3], 11);
  assert.deepStrictEqual(stats.busiestDay, { date: '2025-07-31', count: 11 });
  assert.equal(stats.busiestHour, 3);
  assert.equal(stats.longestStreak, 1);
  assert.deepStrictEqual(stats.longestStreakRange, { start: '2025-07-31', end: '2025-07-31' });
  assert.deepStrictEqual(stats.topWords.slice(0, 6), [
    ['end', 2],
    ['only', 2],
    ['morning', 2],
    ['imbl', 2],
    ['sorry', 2],
    ['send', 2]
  ]);
  assert.deepStrictEqual(stats.responseTimes, { Imbl: 1.12, '~Ieommq': 1.49 });
});

test('filterMessagesByDate respects inclusive date ranges', () => {
  const fullDay = filterMessagesByDate(messages, '2025-07-31', '2025-07-31');
  assert.equal(fullDay.length, 11);

  const future = filterMessagesByDate(messages, '2025-08-01', '2025-08-01');
  assert.equal(future.length, 0);

  const openEnded = filterMessagesByDate(messages, null, '2025-07-30');
  assert.equal(openEnded.length, 0);
});

test('generateMarkdownSummary produces a rich overview', () => {
  const markdown = generateMarkdownSummary({
    title: 'Example Chat Recap',
    messages,
    stats,
    sampleCount: 2
  });

  assert.match(markdown, /^# Example Chat Recap/m);
  assert.match(markdown, /\*\*Timeframe:\*\* 2025-07-31 → 2025-07-31/);
  assert.match(markdown, /## Participation/);
  assert.match(markdown, /~Ieommq: \*\*7\*\* messages/);
  assert.match(markdown, /## Frequently used words/);
  assert.match(markdown, /## Representative moments/);
});
