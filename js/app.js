import {
  parseChat,
  computeStatistics,
  filterMessagesByDate,
  generateMarkdownSummary
} from './chatParser.js';

let allMessages = [];
let filteredMessages = [];
let stats = null;
let fullStats = null;
let participantsChart = null;
let hourlyChart = null;

const fileInput = document.getElementById('chat-file');
const fileHelper = document.getElementById('file-helper');
const loadStatus = document.getElementById('load-status');
const startDateInput = document.getElementById('start-date');
const endDateInput = document.getElementById('end-date');
const applyRangeButton = document.getElementById('apply-range');
const resetRangeButton = document.getElementById('reset-range');
const summaryCardsContainer = document.getElementById('summary-cards');
const topWordsList = document.getElementById('top-words');
const topEmojisList = document.getElementById('top-emojis');
const insightList = document.getElementById('insight-list');
const responseTimesList = document.getElementById('response-times');
const mdTitleInput = document.getElementById('md-title');
const sampleCountInput = document.getElementById('sample-count');
const generateMdButton = document.getElementById('generate-md');
const mdPreview = document.getElementById('md-preview');

async function loadChatFile(file) {
  if (!file) return null;

  if (file.name.toLowerCase().endsWith('.zip')) {
    const arrayBuffer = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);
    const txtFileName = Object.keys(zip.files).find((name) => name.endsWith('.txt'));
    if (!txtFileName) {
      throw new Error('No .txt file found inside the zip archive.');
    }
    return zip.files[txtFileName].async('string');
  }

  return file.text();
}

function formatDateForInput(date) {
  if (!date) return '';
  return date.toISOString().slice(0, 10);
}

function formatDateFriendly(date) {
  if (!date) return '—';
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  }).format(date);
}

function updateSummaryCards(currentStats) {
  const cards = [
    {
      title: 'Messages',
      value: currentStats.totalMessages.toLocaleString(),
      hint: 'Includes only participant messages.'
    },
    {
      title: 'Participants',
      value: currentStats.participants.length,
      hint: 'Unique senders detected.'
    },
    {
      title: 'Total words',
      value: currentStats.totalWords.toLocaleString(),
      hint: 'Excludes attachments and system notifications.'
    },
    {
      title: 'Media shared',
      value: currentStats.mediaCount.toLocaleString(),
      hint: 'Messages detected as photos, videos, voice notes, etc.'
    },
    {
      title: 'First message',
      value: formatDateFriendly(currentStats.firstMessageDate),
      hint: 'Within the selected range.'
    },
    {
      title: 'Last message',
      value: formatDateFriendly(currentStats.lastMessageDate),
      hint: 'Within the selected range.'
    }
  ];

  if (currentStats.overallAverageResponseMinutes !== null) {
    cards.push({
      title: 'Avg response time',
      value: `${currentStats.overallAverageResponseMinutes} min`,
      hint: `Median ${currentStats.overallMedianResponseMinutes} min across replies.`
    });
  }

  if (currentStats.fastestResponder) {
    cards.push({
      title: 'Fastest responder',
      value: currentStats.fastestResponder.participant,
      hint: `~${currentStats.fastestResponder.averageMinutes} min avg reply`
    });
  }

  summaryCardsContainer.innerHTML = cards
    .map((card) => `
      <article class="stat-card">
        <h3>${card.title}</h3>
        <p>${card.value}</p>
        <span>${card.hint}</span>
      </article>
    `)
    .join('');
}

function renderChart({ elementId, labels, data, label, color, chartRef }) {
  const ctx = document.getElementById(elementId);
  if (!ctx) return null;

  if (chartRef) {
    chartRef.destroy();
  }

  return new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label,
          data,
          backgroundColor: color,
          borderRadius: 8
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          ticks: {
            color: '#cbd5f5',
            maxRotation: 45,
            minRotation: 0,
            autoSkip: labels.length > 12
          },
          grid: {
            color: 'rgba(148, 163, 184, 0.1)'
          }
        },
        y: {
          ticks: {
            color: '#cbd5f5'
          },
          grid: {
            color: 'rgba(148, 163, 184, 0.1)'
          }
        }
      },
      plugins: {
        legend: {
          display: false
        }
      }
    }
  });
}

function updateCharts(currentStats) {
  const participantLabels = currentStats.participants;
  const participantData = participantLabels.map((participant) => currentStats.messageCountByParticipant[participant]);

  participantsChart = renderChart({
    elementId: 'participants-chart',
    labels: participantLabels,
    data: participantData,
    label: 'Messages',
    color: 'rgba(56, 189, 248, 0.65)',
    chartRef: participantsChart
  });

  const hourlyLabels = Array.from({ length: 24 }, (_, i) => `${i.toString().padStart(2, '0')}:00`);
  const hourlyData = currentStats.messagesByHour;

  hourlyChart = renderChart({
    elementId: 'hourly-chart',
    labels: hourlyLabels,
    data: hourlyData,
    label: 'Messages per hour',
    color: 'rgba(129, 140, 248, 0.65)',
    chartRef: hourlyChart
  });
}

function updateTopList(container, items, formatter) {
  if (!items.length) {
    container.innerHTML = '<li>No data yet</li>';
    return;
  }

  container.innerHTML = items
    .map((item) => `<li>${formatter(item)}</li>`)
    .join('');
}

function updateResponseTimes(currentStats) {
  if (!responseTimesList) return;
  const entries = Object.entries(currentStats.responseTimeDetails || {});
  if (!entries.length) {
    responseTimesList.innerHTML = '<li>No response time data yet</li>';
    return;
  }

  const sorted = entries.sort((a, b) => a[1].averageMinutes - b[1].averageMinutes);
  responseTimesList.innerHTML = sorted
    .map(([participant, detail]) => `
      <li>
        <span>${participant}</span>
        <span>${detail.averageMinutes}m avg · ${detail.medianMinutes}m median · ${detail.samples} replies</span>
      </li>
    `)
    .join('');
}

function buildInsights(currentStats) {
  const insights = [];
  if (currentStats.busiestDay) {
    insights.push(`Most active day: <strong>${currentStats.busiestDay.date}</strong> with ${currentStats.busiestDay.count} messages.`);
  }
  if (currentStats.busiestHour !== null) {
    insights.push(`Peak hour: <strong>${currentStats.busiestHour}:00</strong> (UTC) when the chat is most lively.`);
  }
  if (currentStats.longestStreak > 1 && currentStats.longestStreakRange) {
    insights.push(`Longest daily streak: <strong>${currentStats.longestStreak} days</strong> from ${currentStats.longestStreakRange.start} to ${currentStats.longestStreakRange.end}.`);
  }
  if (currentStats.overallAverageResponseMinutes !== null) {
    const median = currentStats.overallMedianResponseMinutes !== null
      ? ` (median ${currentStats.overallMedianResponseMinutes} minutes)`
      : '';
    insights.push(`Typical reply time: <strong>${currentStats.overallAverageResponseMinutes} minutes</strong>${median}.`);
  }
  if (currentStats.fastestResponder) {
    insights.push(`Quickest responder: <strong>${currentStats.fastestResponder.participant}</strong> averaging about ${currentStats.fastestResponder.averageMinutes} minutes.`);
  }
  if (currentStats.slowestResponder && (!currentStats.fastestResponder || currentStats.slowestResponder.participant !== currentStats.fastestResponder.participant)) {
    insights.push(`Leisurely replies: <strong>${currentStats.slowestResponder.participant}</strong> averages about ${currentStats.slowestResponder.averageMinutes} minutes.`);
  }
  if (!insights.length) {
    insights.push('Insights will appear here once you load a chat.');
  }

  insightList.innerHTML = insights.map((item) => `<li>${item}</li>`).join('');
}

function enableControls(enabled) {
  [startDateInput, endDateInput, applyRangeButton, resetRangeButton, generateMdButton].forEach((el) => {
    el.disabled = !enabled;
  });
}

function applyFilters() {
  const start = startDateInput.value || null;
  const end = endDateInput.value || null;

  filteredMessages = filterMessagesByDate(allMessages, start, end);
  stats = computeStatistics(filteredMessages);
  updateSummaryCards(stats);
  updateCharts(stats);

  updateTopList(topWordsList, stats.topWords, ([word, count]) => `<span>${word}</span><span>${count}</span>`);
  updateTopList(topEmojisList, stats.topEmojis, ([emoji, count]) => `<span>${emoji}</span><span>${count}</span>`);
  updateResponseTimes(stats);
  buildInsights(stats);
}

function resetFilters() {
  if (!fullStats) return;
  startDateInput.value = formatDateForInput(fullStats.firstMessageDate);
  endDateInput.value = formatDateForInput(fullStats.lastMessageDate);
  filteredMessages = [...allMessages];
  stats = computeStatistics(filteredMessages);
  updateSummaryCards(stats);
  updateCharts(stats);
  updateTopList(topWordsList, stats.topWords, ([word, count]) => `<span>${word}</span><span>${count}</span>`);
  updateTopList(topEmojisList, stats.topEmojis, ([emoji, count]) => `<span>${emoji}</span><span>${count}</span>`);
  updateResponseTimes(stats);
  buildInsights(stats);
}

function showError(message) {
  loadStatus.textContent = message;
  loadStatus.classList.add('error');
}

function clearStatus() {
  loadStatus.textContent = '';
  loadStatus.classList.remove('error');
}

function prepareMarkdown() {
  if (!stats) return;
  const sampleCount = Math.max(0, Math.min(10, Number(sampleCountInput.value) || 0));
  const markdown = generateMarkdownSummary({
    title: mdTitleInput.value.trim() || 'WhatsApp Chat Summary',
    messages: filteredMessages,
    stats,
    startDate: startDateInput.value || undefined,
    endDate: endDateInput.value || undefined,
    sampleCount
  });

  mdPreview.value = markdown;

  const blob = new Blob([markdown], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${(mdTitleInput.value || 'whatsapp-chat-summary').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.md`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

fileInput.addEventListener('change', async (event) => {
  const [file] = event.target.files;
  if (!file) return;

  fileHelper.textContent = file.name;
  loadStatus.textContent = 'Parsing chat…';
  clearStatus();

  try {
    const rawText = await loadChatFile(file);
    allMessages = parseChat(rawText);

    if (!allMessages.length) {
      throw new Error('No messages could be parsed. Please ensure this is a standard WhatsApp export.');
    }

    fullStats = computeStatistics(allMessages);
    stats = fullStats;
    filteredMessages = [...allMessages];

    const firstDate = formatDateForInput(fullStats.firstMessageDate);
    const lastDate = formatDateForInput(fullStats.lastMessageDate);

    startDateInput.value = firstDate;
    startDateInput.min = firstDate;
    startDateInput.max = lastDate;
    endDateInput.value = lastDate;
    endDateInput.min = firstDate;
    endDateInput.max = lastDate;

    enableControls(true);
    applyFilters();

    loadStatus.textContent = `Loaded ${stats.totalMessages.toLocaleString()} messages from ${stats.participants.length} participants.`;
  } catch (error) {
    console.error(error);
    showError(error.message || 'Something went wrong while parsing the chat.');
    enableControls(false);
  }
});

applyRangeButton.addEventListener('click', () => {
  applyFilters();
  loadStatus.textContent = 'Filters applied.';
});

resetRangeButton.addEventListener('click', () => {
  resetFilters();
  loadStatus.textContent = 'Filters reset to full range.';
});

generateMdButton.addEventListener('click', () => {
  prepareMarkdown();
  loadStatus.textContent = 'Markdown summary generated!';
});

document.addEventListener('dragover', (event) => {
  if (event.target === fileInput || fileInput.contains(event.target)) return;
  event.preventDefault();
});

document.addEventListener('drop', async (event) => {
  if (!event.dataTransfer?.files?.length) return;
  event.preventDefault();
  fileInput.files = event.dataTransfer.files;
  fileInput.dispatchEvent(new Event('change'));
});

window.addEventListener('DOMContentLoaded', () => {
  enableControls(false);
  mdPreview.value = '';
  if (responseTimesList) {
    responseTimesList.innerHTML = '<li>Response times will appear after loading a chat.</li>';
  }
});
