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
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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

function updateResponseTimesList(currentStats) {
  if (!responseTimesList) return;

  if (!currentStats.participants.length) {
    responseTimesList.innerHTML = '<li class="empty">No participants yet</li>';
    return;
  }

  const formatter = new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  });

  const entries = currentStats.participants
    .map((participant, index) => {
      const value = currentStats.responseTimes?.[participant];
      return {
        participant,
        minutes: typeof value === 'number' ? value : null,
        order: index
      };
    })
    .sort((a, b) => {
      if (a.minutes === null && b.minutes === null) {
        return a.order - b.order;
      }
      if (a.minutes === null) return 1;
      if (b.minutes === null) return -1;
      if (a.minutes === b.minutes) {
        return a.participant.localeCompare(b.participant);
      }
      return a.minutes - b.minutes;
    });

  responseTimesList.innerHTML = entries
    .map(({ participant, minutes }) => {
      const label = minutes === null ? '—' : `${formatter.format(minutes)} min`;
      return `
        <li>
          <span class="response-name">${participant}</span>
          <span class="response-time-value">${label}</span>
        </li>
      `;
    })
    .join('');
}

function buildInsights(currentStats) {
  updateResponseTimesList(currentStats);
  const insights = [];
  if (currentStats.busiestDay) {
    insights.push(`Most active day: <strong>${currentStats.busiestDay.date}</strong> with ${currentStats.busiestDay.count} messages.`);
  }
  if (currentStats.busiestHour !== null) {
    const hourLabel = String(currentStats.busiestHour).padStart(2, '0');
    insights.push(`Peak hour: <strong>${hourLabel}:00</strong> when the chat is most lively.`);
  }
  if (currentStats.longestStreak > 1 && currentStats.longestStreakRange) {
    insights.push(`Longest daily streak: <strong>${currentStats.longestStreak} days</strong> from ${currentStats.longestStreakRange.start} to ${currentStats.longestStreakRange.end}.`);
  }
    if (Object.keys(currentStats.responseTimes).length) {
      const fastest = Object.entries(currentStats.responseTimes).sort((a, b) => a[1] - b[1])[0];
      if (fastest) {
        insights.push(`Quickest responder: <strong>${fastest[0]}</strong> with an average reply around ${fastest[1]} minutes.`);
      }
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
  clearStatus();
  loadStatus.textContent = 'Parsing chat…';

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
});
