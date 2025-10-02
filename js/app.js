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
let wordsChart = null;
let activeDateFormat = 'DMY';
let rawChatText = '';

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
const participantWordSelect = document.getElementById('participant-word-select');
const participantWordSelector = document.getElementById('participant-word-selector');
const participantWordSummary = document.getElementById('participant-word-summary');
const participantTopWordsList = document.getElementById('participant-top-words');
const topEmojisList = document.getElementById('top-emojis');
const insightList = document.getElementById('insight-list');
const responseTimesList = document.getElementById('response-times');
const longestMessagesList = document.getElementById('longest-messages');
const responseGapInput = document.getElementById('response-gap-limit');
const responseOvernightToggle = document.getElementById('response-overnight-toggle');
const responseOvernightMinutesInput = document.getElementById('response-overnight-minutes');
const responseCutoffNote = document.getElementById('response-cutoff-note');
const mdTitleInput = document.getElementById('md-title');
const sampleCountInput = document.getElementById('sample-count');
const generateMdButton = document.getElementById('generate-md');
const mdPreview = document.getElementById('md-preview');

let selectedParticipantForWords = null;

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

function formatDateTimeFriendly(date) {
  if (!date) return '—';
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(date);
}

function describeDateFormat(format) {
  return format === 'MDY' ? 'month/day/year' : 'day/month/year';
}

function escapeHtml(text) {
  if (text === null || typeof text === 'undefined') {
    return '';
  }
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeSelector(value) {
  if (value === null || typeof value === 'undefined') {
    return '';
  }
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(String(value));
  }
  return String(value).replace(/([ !"#$%&'()*+,./:;<=>?@[\]^`{|}~])/g, '\\$1');
}

function formatSnippet(text) {
  if (!text) return '—';
  const flattened = text.replace(/\s+/g, ' ').trim();
  if (!flattened) return '—';
  if (flattened.length <= 160) {
    return flattened;
  }
  return `${flattened.slice(0, 157)}…`;
}

function getResponseOptions() {
  if (!responseGapInput) {
    return {};
  }

  const gapValue = Number(responseGapInput.value);
  const hasGap = Number.isFinite(gapValue) && gapValue > 0;
  const responseGapMinutes = hasGap ? gapValue : null;

  const overnightEnabled = Boolean(responseOvernightToggle?.checked) && hasGap;
  const overnightValue = Number(responseOvernightMinutesInput?.value);
  const overnightBufferMinutes = overnightEnabled && Number.isFinite(overnightValue) && overnightValue > 0
    ? overnightValue
    : 0;

  return {
    responseGapMinutes,
    overnightBufferMinutes
  };
}

function syncResponseControlState() {
  if (!responseGapInput || !responseOvernightToggle || !responseOvernightMinutesInput) {
    return;
  }

  const gapValue = Number(responseGapInput.value);
  const hasGap = Number.isFinite(gapValue) && gapValue > 0 && !responseGapInput.disabled;

  responseOvernightToggle.disabled = !hasGap;
  const overnightEnabled = hasGap && responseOvernightToggle.checked && !responseOvernightToggle.disabled;
  responseOvernightMinutesInput.disabled = !overnightEnabled;
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
  const averageWords = currentStats.overallAverageWordsPerMessage;
  const averageWordsLabel = typeof averageWords === 'number' && averageWords > 0
    ? averageWords.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
    : '0';
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
      title: 'Avg words/message',
      value: averageWordsLabel,
      hint: 'Across all participant messages.'
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

function renderChart({ elementId, labels, data, label, color, chartRef, datasets, type = 'bar', options = {} }) {
  const ctx = document.getElementById(elementId);
  if (!ctx) return null;

  if (chartRef) {
    chartRef.destroy();
  }

  const resolvedDatasets = Array.isArray(datasets) && datasets.length
    ? datasets
    : [
      {
        label,
        data,
        backgroundColor: color,
        borderRadius: 8
      }
    ];

  const baseOptions = {
    type,
    data: {
      labels,
      datasets: resolvedDatasets
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
          display: false,
          labels: {
            color: '#cbd5f5'
          }
        }
      }
    }
  };

  const mergedOptions = { ...baseOptions.options };
  const userOptions = options || {};

  if (userOptions.scales) {
    mergedOptions.scales = { ...mergedOptions.scales };
    for (const [key, value] of Object.entries(userOptions.scales)) {
      mergedOptions.scales[key] = {
        ...(mergedOptions.scales[key] || {}),
        ...value
      };
    }
  }

  if (userOptions.plugins) {
    mergedOptions.plugins = { ...mergedOptions.plugins };
    for (const [key, value] of Object.entries(userOptions.plugins)) {
      mergedOptions.plugins[key] = {
        ...(mergedOptions.plugins[key] || {}),
        ...value
      };
      if (key === 'legend' && value.labels) {
        mergedOptions.plugins.legend.labels = {
          ...(mergedOptions.plugins.legend.labels || {}),
          ...value.labels
        };
      }
    }
  }

  for (const [key, value] of Object.entries(userOptions)) {
    if (key === 'scales' || key === 'plugins') continue;
    mergedOptions[key] = value;
  }

  return new Chart(ctx, {
    type,
    data: {
      labels,
      datasets: resolvedDatasets
    },
    options: mergedOptions
  });
}

function updateCharts(currentStats) {
  const participantLabels = currentStats.participants;
  const participantData = participantLabels.map((participant) => currentStats.messageCountByParticipant[participant]);

  participantsChart = renderChart({
    elementId: 'participants-chart',
    labels: participantLabels,
    datasets: [
      {
        label: 'Messages',
        data: participantData,
        backgroundColor: 'rgba(56, 189, 248, 0.65)',
        borderRadius: 8
      }
    ],
    chartRef: participantsChart
  });

  const hourlyLabels = Array.from({ length: 24 }, (_, i) => `${i.toString().padStart(2, '0')}:00`);
  const hourlyData = currentStats.messagesByHour;

  hourlyChart = renderChart({
    elementId: 'hourly-chart',
    labels: hourlyLabels,
    datasets: [
      {
        label: 'Messages per hour',
        data: hourlyData,
        backgroundColor: 'rgba(129, 140, 248, 0.65)',
        borderRadius: 8
      }
    ],
    chartRef: hourlyChart
  });

  const totalWordData = participantLabels.map((participant) => currentStats.wordCountByParticipant[participant] || 0);
  const averageWordData = participantLabels.map((participant) => currentStats.averageWordsPerMessage?.[participant] || 0);

  wordsChart = renderChart({
    elementId: 'words-chart',
    labels: participantLabels,
    datasets: [
      {
        type: 'bar',
        label: 'Total words',
        data: totalWordData,
        backgroundColor: 'rgba(34, 197, 94, 0.65)',
        borderRadius: 8,
        yAxisID: 'y',
        order: 2
      },
      {
        type: 'line',
        label: 'Avg words/msg',
        data: averageWordData,
        borderColor: 'rgba(244, 114, 182, 0.9)',
        backgroundColor: 'rgba(244, 114, 182, 0.35)',
        tension: 0.35,
        pointRadius: 4,
        pointBackgroundColor: 'rgba(244, 114, 182, 1)',
        pointBorderColor: 'rgba(244, 114, 182, 1)',
        borderWidth: 2,
        yAxisID: 'y1',
        order: 1
      }
    ],
    chartRef: wordsChart,
    options: {
      scales: {
        y: {
          title: {
            display: true,
            text: 'Total words',
            color: '#cbd5f5'
          }
        },
        y1: {
          position: 'right',
          grid: {
            drawOnChartArea: false,
            color: 'rgba(148, 163, 184, 0.1)'
          },
          ticks: {
            color: '#fbcfe8'
          },
          title: {
            display: true,
            text: 'Average words per message',
            color: '#fbcfe8'
          }
        }
      },
      plugins: {
        legend: {
          display: true,
          labels: {
            color: '#cbd5f5'
          }
        }
      }
    }
  });
}

function updateTopList(container, items, formatter, emptyMessage = 'No data yet') {
  if (!items.length) {
    container.innerHTML = `<li>${emptyMessage}</li>`;
    return;
  }

  container.innerHTML = items
    .map((item) => `<li>${formatter(item)}</li>`)
    .join('');
}

function renderLongestMessages(currentStats) {
  if (!longestMessagesList) return;

  if (!currentStats.participants.length) {
    longestMessagesList.innerHTML = '<li class="empty">No participants yet</li>';
    return;
  }

  const entries = currentStats.participants.map((participant) => {
    const record = currentStats.longestMessageByParticipant?.[participant];
    if (!record) {
      return `
        <li>
          <div class="longest-message-header">
            <span class="participant-name">${escapeHtml(participant)}</span>
            <span class="message-length">No qualifying message</span>
          </div>
          <div class="longest-message-meta">—</div>
          <p class="longest-message-snippet">No qualifying messages yet.</p>
        </li>
      `;
    }

    const descriptor = record.wordCount
      ? `${record.wordCount.toLocaleString()} ${record.wordCount === 1 ? 'word' : 'words'}`
      : `${record.charCount.toLocaleString()} chars`;
    const timestampLabel = formatDateTimeFriendly(record.timestamp instanceof Date ? record.timestamp : new Date(record.timestamp));
    const snippet = formatSnippet(record.content);

    return `
      <li>
        <div class="longest-message-header">
          <span class="participant-name">${escapeHtml(participant)}</span>
          <span class="message-length">${escapeHtml(descriptor)}</span>
        </div>
        <div class="longest-message-meta">${escapeHtml(timestampLabel)}</div>
        <p class="longest-message-snippet">${escapeHtml(snippet)}</p>
      </li>
    `;
  });

  longestMessagesList.innerHTML = entries.join('');
}

function renderParticipantWordBreakdown(currentStats) {
  if (!participantWordSelect || !participantTopWordsList) return;

  const participants = currentStats.participants || [];
  participantWordSelect.innerHTML = '';
  if (participantWordSelector) {
    if (typeof participantWordSelector.replaceChildren === 'function') {
      participantWordSelector.replaceChildren();
    } else {
      participantWordSelector.innerHTML = '';
    }
  }

  if (!participants.length) {
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'No participants yet';
    participantWordSelect.appendChild(placeholder);
    participantWordSelect.disabled = true;
    participantTopWordsList.innerHTML = '<li>No participants yet</li>';
    selectedParticipantForWords = null;
    if (participantWordSummary) {
      participantWordSummary.textContent = 'No participants yet';
    }
    return;
  }

  const previousSelection = selectedParticipantForWords;
  const nextSelection = previousSelection && participants.includes(previousSelection)
    ? previousSelection
    : participants[0];
  selectedParticipantForWords = nextSelection;

  participants.forEach((participant) => {
    const option = document.createElement('option');
    option.value = participant;
    option.textContent = participant;
    participantWordSelect.appendChild(option);
  });

  if (participantWordSelector) {
    participants.forEach((participant) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'participant-word-pill';
      button.dataset.participant = participant;
      button.setAttribute('role', 'radio');
      const isActive = participant === nextSelection;
      button.setAttribute('aria-checked', String(isActive));
      button.tabIndex = isActive ? 0 : -1;
      button.textContent = participant;
      participantWordSelector.appendChild(button);
    });
  }

  participantWordSelect.disabled = false;
  participantWordSelect.value = nextSelection;

  if (participantWordSummary) {
    const messageCount = currentStats.messageCountByParticipant?.[nextSelection] || 0;
    const totalWords = currentStats.wordCountByParticipant?.[nextSelection] || 0;
    const averageWords = currentStats.averageWordsPerMessage?.[nextSelection] || 0;
    const numberFormatter = new Intl.NumberFormat();
    const averageFormatter = new Intl.NumberFormat(undefined, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1
    });
    const segments = [];

    if (messageCount > 0) {
      segments.push(`${averageFormatter.format(averageWords)} words/msg`);
      segments.push(`${numberFormatter.format(messageCount)} ${messageCount === 1 ? 'message' : 'messages'}`);
    }

    if (totalWords > 0) {
      segments.push(`${numberFormatter.format(totalWords)} words total`);
    }

    participantWordSummary.textContent = segments.length
      ? segments.join(' · ')
      : 'No participant messages yet';
  }

  const entries = currentStats.topWordsByParticipant?.[nextSelection] || [];
  updateTopList(
    participantTopWordsList,
    entries,
    ([word, count]) => `<span>${escapeHtml(word)}</span><span>${count}</span>`,
    'No words yet'
  );
}

function focusParticipantWordPill(participant) {
  if (!participantWordSelector || !participant) return;
  const safeSelector = `[data-participant="${escapeSelector(participant)}"]`;
  const button = participantWordSelector.querySelector(safeSelector);
  button?.focus();
}

function selectParticipantForWords(participant, { focus = false } = {}) {
  if (!participant || !stats) return;
  if (participant === selectedParticipantForWords) {
    if (focus) {
      setTimeout(() => focusParticipantWordPill(participant), 0);
    }
    return;
  }
  selectedParticipantForWords = participant;
  if (participantWordSelect) {
    participantWordSelect.value = participant;
  }
  renderParticipantWordBreakdown(stats);
  if (focus) {
    setTimeout(() => focusParticipantWordPill(participant), 0);
  }
}

function renderStats(currentStats) {
  updateSummaryCards(currentStats);
  updateCharts(currentStats);
  updateTopList(topWordsList, currentStats.topWords, ([word, count]) => `<span>${escapeHtml(word)}</span><span>${count}</span>`);
  updateTopList(topEmojisList, currentStats.topEmojis, ([emoji, count]) => `<span>${escapeHtml(emoji)}</span><span>${count}</span>`);
  renderLongestMessages(currentStats);
  renderParticipantWordBreakdown(currentStats);
  buildInsights(currentStats);
}

function refreshStats() {
  const options = getResponseOptions();
  stats = computeStatistics(filteredMessages, options);
  renderStats(stats);
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
      const metrics = currentStats.responseTimes?.[participant];
      const average = typeof metrics?.averageMinutes === 'number' ? metrics.averageMinutes : null;
      const median = typeof metrics?.medianMinutes === 'number' ? metrics.medianMinutes : null;
      const samples = typeof metrics?.samples === 'number' ? metrics.samples : 0;
      return {
        participant,
        average,
        median,
        samples,
        order: index
      };
    })
    .sort((a, b) => {
      const aHasMetrics = a.median !== null || a.average !== null;
      const bHasMetrics = b.median !== null || b.average !== null;

      if (!aHasMetrics && !bHasMetrics) {
        return a.order - b.order;
      }
      if (!aHasMetrics) return 1;
      if (!bHasMetrics) return -1;

      const aKey = a.median ?? a.average;
      const bKey = b.median ?? b.average;

      if (aKey === bKey) {
        const aAvg = a.average ?? aKey;
        const bAvg = b.average ?? bKey;
        if (aAvg === bAvg) {
          return a.participant.localeCompare(b.participant);
        }
        return aAvg - bAvg;
      }
      return aKey - bKey;
    });

  responseTimesList.innerHTML = entries
    .map(({ participant, average, median, samples }) => {
      if (average === null && median === null) {
        return `
        <li>
          <span class="response-name">${participant}</span>
          <span class="response-time-value">—</span>
        </li>
      `;
      }

      const metrics = [];
      if (average !== null) {
        metrics.push(`
          <span class="response-metric" data-kind="avg">
            <span class="metric-label">avg</span>
            <span class="metric-value">${formatter.format(average)} min</span>
          </span>
        `);
      }
      if (median !== null) {
        metrics.push(`
          <span class="response-metric" data-kind="median">
            <span class="metric-label">median</span>
            <span class="metric-value">${formatter.format(median)} min</span>
          </span>
        `);
      }

      const metricsHtml = metrics.map((metric) => metric.trim()).join('');
      const sampleLabel = samples > 0
        ? `<span class="response-sample">${samples} gap${samples === 1 ? '' : 's'}</span>`
        : '';

      return `
        <li>
          <span class="response-name">${participant}</span>
          <span class="response-time-value">${metricsHtml}${sampleLabel}</span>
        </li>
      `;
    })
    .join('');
}

function updateResponseCutoffNote(currentStats) {
  if (!responseCutoffNote) return;

  if (!currentStats || typeof currentStats.totalMessages === 'undefined') {
    responseCutoffNote.textContent = 'Reply time stats (avg & median) will appear once a chat is loaded.';
    return;
  }

  if (!currentStats.participants.length) {
    responseCutoffNote.textContent = 'Reply time stats will appear once participants start chatting.';
    return;
  }

  const hasResponseData = Object.values(currentStats.responseTimes || {}).some((value) => (
    value && (typeof value.medianMinutes === 'number' || typeof value.averageMinutes === 'number')
  ));
  const gap = currentStats.responseGapMinutes;
  const overnight = currentStats.responseGapOvernightBufferMinutes || 0;

  if (!gap) {
    responseCutoffNote.textContent = hasResponseData
      ? 'Counting every reply gap between different participants and reporting average/median times.'
      : 'No qualifying reply gaps yet — once someone replies, average and median times will appear here.';
    return;
  }

  const parts = [`Ignoring gaps longer than ${gap.toLocaleString()} min`];
  if (overnight) {
    parts.push(`(+${overnight.toLocaleString()} min when replies cross midnight)`);
  }

  responseCutoffNote.textContent = hasResponseData
    ? `${parts.join(' ')}. Showing average and median reply times for each participant.`
    : `${parts.join(' ')}. No qualifying reply gaps yet with this cutoff.`;
}

function buildInsights(currentStats) {
  updateResponseTimesList(currentStats);
  updateResponseCutoffNote(currentStats);
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
  const responseEntries = Object.entries(currentStats.responseTimes || {})
    .filter(([, metrics]) => metrics && typeof metrics.medianMinutes === 'number');
  if (responseEntries.length) {
    responseEntries.sort((a, b) => {
      if (a[1].medianMinutes === b[1].medianMinutes) {
        return (a[1].averageMinutes ?? Number.POSITIVE_INFINITY)
          - (b[1].averageMinutes ?? Number.POSITIVE_INFINITY);
      }
      return a[1].medianMinutes - b[1].medianMinutes;
    });
    const [fastestName, fastestMetrics] = responseEntries[0];
    const formatMinutes = (value) => value.toLocaleString(undefined, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1
    });
    const averageLabel = typeof fastestMetrics.averageMinutes === 'number'
      ? `${formatMinutes(fastestMetrics.averageMinutes)} min`
      : '—';
    const medianLabel = typeof fastestMetrics.medianMinutes === 'number'
      ? `${formatMinutes(fastestMetrics.medianMinutes)} min`
      : '—';
    insights.push(`Quickest responder: <strong>${fastestName}</strong> with replies averaging ${averageLabel} (median ${medianLabel}).`);
  }
  if (!insights.length) {
    insights.push('Insights will appear here once you load a chat.');
  }

  insightList.innerHTML = insights.map((item) => `<li>${item}</li>`).join('');
}

function enableControls(enabled) {
  [
    startDateInput,
    endDateInput,
    applyRangeButton,
    resetRangeButton,
    generateMdButton,
    responseGapInput,
    responseOvernightToggle,
    responseOvernightMinutesInput
  ].forEach((el) => {
    el.disabled = !enabled;
  });
  if (!enabled && responseCutoffNote) {
    responseCutoffNote.textContent = 'Reply time stats (avg & median) will appear once a chat is loaded.';
  }
  syncResponseControlState();
}

function handleResponseSettingsChange() {
  if (!allMessages.length) {
    syncResponseControlState();
    return;
  }

  syncResponseControlState();
  refreshStats();
  loadStatus.textContent = 'Reply gap settings updated.';
}

function applyFilters() {
  const start = startDateInput.value || null;
  const end = endDateInput.value || null;

  filteredMessages = filterMessagesByDate(allMessages, start, end);
  refreshStats();
}

function resetFilters() {
  if (!fullStats) return;
  startDateInput.value = formatDateForInput(fullStats.firstMessageDate);
  endDateInput.value = formatDateForInput(fullStats.lastMessageDate);
  filteredMessages = [...allMessages];
  refreshStats();
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
  fullStats = computeStatistics(messages);
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
  refreshStats();

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

participantWordSelect?.addEventListener('change', (event) => {
  const value = event.target.value || null;
  if (value) {
    selectParticipantForWords(value);
  }
});

participantWordSelector?.addEventListener('click', (event) => {
  const target = event.target.closest('.participant-word-pill');
  if (!target || !participantWordSelector.contains(target)) return;
  const participant = target.dataset.participant;
  if (participant) {
    selectParticipantForWords(participant, { focus: true });
  }
});

participantWordSelector?.addEventListener('keydown', (event) => {
  if (!stats) return;
  const buttons = Array.from(participantWordSelector.querySelectorAll('.participant-word-pill'));
  if (!buttons.length) return;
  const key = event.key;

  const getIndex = () => buttons.findIndex((button) => button.dataset.participant === selectedParticipantForWords);
  const moveToIndex = (index) => {
    if (index < 0 || index >= buttons.length) return;
    const participant = buttons[index].dataset.participant;
    if (participant) {
      selectParticipantForWords(participant, { focus: true });
    }
  };

  if (key === 'ArrowRight' || key === 'ArrowDown') {
    event.preventDefault();
    const index = getIndex();
    const nextIndex = index === -1 ? 0 : (index + 1) % buttons.length;
    moveToIndex(nextIndex);
  } else if (key === 'ArrowLeft' || key === 'ArrowUp') {
    event.preventDefault();
    const index = getIndex();
    const nextIndex = index === -1 ? buttons.length - 1 : (index - 1 + buttons.length) % buttons.length;
    moveToIndex(nextIndex);
  } else if (key === 'Home') {
    event.preventDefault();
    moveToIndex(0);
  } else if (key === 'End') {
    event.preventDefault();
    moveToIndex(buttons.length - 1);
  } else if (key === ' ' || key === 'Enter') {
    const target = event.target.closest('.participant-word-pill');
    if (target?.dataset.participant) {
      event.preventDefault();
      selectParticipantForWords(target.dataset.participant, { focus: true });
    }
  }
});

generateMdButton.addEventListener('click', () => {
  prepareMarkdown();
  loadStatus.textContent = 'Markdown summary generated!';
});

responseGapInput?.addEventListener('input', handleResponseSettingsChange);
responseOvernightToggle?.addEventListener('change', handleResponseSettingsChange);
responseOvernightMinutesInput?.addEventListener('input', handleResponseSettingsChange);

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
  if (participantTopWordsList) {
    participantTopWordsList.innerHTML = '<li>No participants yet</li>';
  }
});
