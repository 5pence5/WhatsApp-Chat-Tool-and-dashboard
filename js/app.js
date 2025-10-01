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
let activeDateFormat = 'DMY';
let rawChatText = '';
const DEFAULT_RESPONSE_THRESHOLD_MINUTES = 360;
let responseThresholdMinutes = DEFAULT_RESPONSE_THRESHOLD_MINUTES;

const fileInput = document.getElementById('chat-file');
const fileHelper = document.getElementById('file-helper');
const loadStatus = document.getElementById('load-status');
const dateFormatChooser = document.createElement('div');
const startDateInput = document.getElementById('start-date');
const endDateInput = document.getElementById('end-date');
const applyRangeButton = document.getElementById('apply-range');
const resetRangeButton = document.getElementById('reset-range');
const summaryCardsContainer = document.getElementById('summary-cards');
const topWordsList = document.getElementById('top-words');
const topEmojisList = document.getElementById('top-emojis');
const insightList = document.getElementById('insight-list');
const responseTimesList = document.getElementById('response-times');
const responseThresholdSelect = document.getElementById('response-threshold');
const responseThresholdInfo = document.getElementById('response-threshold-info');
const mdTitleInput = document.getElementById('md-title');
const sampleCountInput = document.getElementById('sample-count');
const generateMdButton = document.getElementById('generate-md');
const mdPreview = document.getElementById('md-preview');

function parseThresholdValue(value) {
  if (value === 'infinite') {
    return Number.POSITIVE_INFINITY;
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return DEFAULT_RESPONSE_THRESHOLD_MINUTES;
  }
  return Math.max(0, parsed);
}

if (responseThresholdSelect) {
  responseThresholdMinutes = parseThresholdValue(responseThresholdSelect.value);
}

dateFormatChooser.id = 'date-format-chooser';
dateFormatChooser.className = 'date-format-chooser';
dateFormatChooser.hidden = true;
loadStatus.insertAdjacentElement('afterend', dateFormatChooser);

async function loadChatFile(file) {
  if (!file) return null;

  if (file.name.toLowerCase().endsWith('.zip')) {
    const arrayBuffer = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);
    const txtFileName = Object.keys(zip.files).find((name) => {
      const baseName = name.split('/').pop() || name;
      if (baseName.startsWith('._')) {
        return false;
      }
      return baseName.toLowerCase().endsWith('.txt');
    });
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

function describeDateFormat(format) {
  return format === 'MDY' ? 'month/day/year' : 'day/month/year';
}

function hideDateFormatChooser() {
  dateFormatChooser.hidden = true;
  dateFormatChooser.innerHTML = '';
}

function renderDateFormatChooser(parseResult) {
  if (!parseResult || !parseResult.ambiguous) {
    hideDateFormatChooser();
    return;
  }

  dateFormatChooser.hidden = false;
  dateFormatChooser.innerHTML = '';

  const info = document.createElement('p');
  const currentDescription = describeDateFormat(parseResult.dateFormat);
  info.innerHTML = `Dates could be interpreted multiple ways. Showing as <strong>${currentDescription}</strong>.`;
  dateFormatChooser.appendChild(info);

  const buttonGroup = document.createElement('div');
  buttonGroup.className = 'date-format-choices';

  ['DMY', 'MDY'].forEach((format) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = format === 'MDY' ? 'Use month/day/year' : 'Use day/month/year';
    button.disabled = format === parseResult.dateFormat;
    button.addEventListener('click', () => applyDateFormatOverride(format));
    buttonGroup.appendChild(button);
  });

  dateFormatChooser.appendChild(buttonGroup);
}

function updateLoadSuccessMessage() {
  if (!stats) return;
  const description = describeDateFormat(activeDateFormat);
  loadStatus.textContent = `Loaded ${stats.totalMessages.toLocaleString()} messages from ${stats.participants.length} participants (dates interpreted as ${description}).`;
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
    if (responseThresholdInfo) {
      responseThresholdInfo.textContent = 'Select a chat to analyse reply times.';
    }
    return;
  }

  const formatter = new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  });

  if (responseThresholdInfo) {
    const threshold = currentStats.responseTimeThreshold;
    if (!Number.isFinite(threshold)) {
      responseThresholdInfo.textContent = 'Including every gap between messages.';
    } else {
      const hours = Math.floor(threshold / 60);
      const minutes = Math.round(threshold % 60);
      const parts = [];
      if (hours > 0) {
        parts.push(`${hours} ${hours === 1 ? 'hour' : 'hours'}`);
      }
      if (minutes > 0) {
        parts.push(`${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`);
      }
      if (!parts.length) {
        parts.push('0 minutes');
      }
      responseThresholdInfo.textContent = `Ignoring gaps longer than ${parts.join(' ')}.`;
    }
  }

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
  [startDateInput, endDateInput, applyRangeButton, resetRangeButton, generateMdButton, responseThresholdSelect].forEach((el) => {
    el.disabled = !enabled;
  });
}

function applyFilters() {
  const start = startDateInput.value || null;
  const end = endDateInput.value || null;

  filteredMessages = filterMessagesByDate(allMessages, start, end);
  stats = computeStatistics(filteredMessages, { responseThresholdMinutes });
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
  stats = computeStatistics(filteredMessages, { responseThresholdMinutes });
  updateSummaryCards(stats);
  updateCharts(stats);
  updateTopList(topWordsList, stats.topWords, ([word, count]) => `<span>${word}</span><span>${count}</span>`);
  updateTopList(topEmojisList, stats.topEmojis, ([emoji, count]) => `<span>${emoji}</span><span>${count}</span>`);
  buildInsights(stats);
}

function processParsedChat(parseResult, options = {}) {
  const { messages, dateFormat } = parseResult;
  const { preserveFilters = false } = options;

  if (!messages.length) {
    throw new Error('No messages could be parsed. Please ensure this is a standard WhatsApp export.');
  }

  allMessages = messages;
  filteredMessages = [...messages];
  activeDateFormat = dateFormat;
  fullStats = computeStatistics(messages, { responseThresholdMinutes });
  stats = fullStats;

  const firstDate = formatDateForInput(fullStats.firstMessageDate);
  const lastDate = formatDateForInput(fullStats.lastMessageDate);

  const clampDate = (value, min, max) => {
    if (!value) return min;
    if (value < min) return min;
    if (value > max) return max;
    return value;
  };

  startDateInput.min = firstDate;
  startDateInput.max = lastDate;
  endDateInput.min = firstDate;
  endDateInput.max = lastDate;

  if (preserveFilters) {
    startDateInput.value = clampDate(startDateInput.value, firstDate, lastDate);
    endDateInput.value = clampDate(endDateInput.value, firstDate, lastDate);
    if (endDateInput.value < startDateInput.value) {
      endDateInput.value = startDateInput.value;
    }
  } else {
    startDateInput.value = firstDate;
    endDateInput.value = lastDate;
  }

  enableControls(true);
  applyFilters();

  renderDateFormatChooser(parseResult);
  loadStatus.classList.remove('error');
  updateLoadSuccessMessage();
}

function applyDateFormatOverride(format) {
  if (!rawChatText || format === activeDateFormat) return;

  try {
    const parseResult = parseChat(rawChatText, { dateFormat: format });
    processParsedChat(parseResult, { preserveFilters: true });
  } catch (error) {
    console.error(error);
    showError(error.message || 'Unable to apply the selected date format.');
  }
}

function showError(message) {
  loadStatus.textContent = message;
  loadStatus.classList.add('error');
  hideDateFormatChooser();
}

function clearStatus() {
  loadStatus.textContent = '';
  loadStatus.classList.remove('error');
  hideDateFormatChooser();
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
    rawChatText = await loadChatFile(file);
    const parseResult = parseChat(rawChatText);
    processParsedChat(parseResult);
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

if (responseThresholdSelect) {
  responseThresholdSelect.addEventListener('change', () => {
    responseThresholdMinutes = parseThresholdValue(responseThresholdSelect.value);
    if (!allMessages.length) {
      return;
    }
    fullStats = computeStatistics(allMessages, { responseThresholdMinutes });
    applyFilters();
  });
}

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
