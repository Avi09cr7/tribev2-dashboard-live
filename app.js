const channels = [
  {
    id: "visual",
    label: "Visual",
    color: "#008f7a",
    info: "How much the image changes and pulls the eye. High values usually mean stronger visual attention.",
  },
  {
    id: "auditory",
    label: "Auditory",
    color: "#ff7759",
    info: "How much sound, beat, voice, or music energy is present in the moment.",
  },
  {
    id: "language",
    label: "Language",
    color: "#1863dc",
    info: "A rough signal for speech or message-heavy moments. It is not a transcript.",
  },
  {
    id: "attention",
    label: "Attention",
    color: "#f2a541",
    info: "A combined signal for motion, contrast, novelty, and pace. Higher usually means the moment is easier to notice.",
  },
  {
    id: "motor",
    label: "Motor",
    color: "#4a8f3a",
    info: "Movement energy from cuts, camera motion, people moving, or product movement.",
  },
  {
    id: "salience",
    label: "Salience",
    color: "#b23a48",
    info: "Moments that stand out because something changes sharply in color, motion, or sound.",
  },
  {
    id: "default",
    label: "Default",
    color: "#7d5ba6",
    info: "Quieter stretches with less stimulation. If this stays high, viewers may drift unless the story is very clear.",
  },
];

const els = {
  videoInput: document.getElementById("videoInput"),
  video: document.getElementById("video"),
  dropZone: document.getElementById("dropZone"),
  emptyState: document.getElementById("emptyState"),
  playButton: document.getElementById("playButton"),
  resetButton: document.getElementById("resetButton"),
  currentTime: document.getElementById("currentTime"),
  duration: document.getElementById("duration"),
  activeSecond: document.getElementById("activeSecond"),
  modeBadge: document.getElementById("modeBadge"),
  videoName: document.getElementById("videoName"),
  trCount: document.getElementById("trCount"),
  brainCanvas: document.getElementById("brainCanvas"),
  graphCanvas: document.getElementById("graphCanvas"),
  timelinePanel: document.getElementById("timelinePanel"),
  graphLoader: document.getElementById("graphLoader"),
  graphLegend: document.getElementById("graphLegend"),
  sampleCanvas: document.getElementById("sampleCanvas"),
  secondRail: document.getElementById("secondRail"),
  channelMeters: document.getElementById("channelMeters"),
  analysisBadge: document.getElementById("analysisBadge"),
  analysisPanel: document.getElementById("analysisPanel"),
  engagementScore: document.getElementById("engagementScore"),
  engagementVerdict: document.getElementById("engagementVerdict"),
  engagementSummary: document.getElementById("engagementSummary"),
  timestampInsights: document.getElementById("timestampInsights"),
  improvementList: document.getElementById("improvementList"),
  campaignList: document.getElementById("campaignList"),
};

const state = {
  mode: "demo",
  videoUrl: null,
  sourceName: "No video",
  duration: 0,
  seconds: 0,
  liveSeries: createSeries(1),
  featureSeries: [],
  counts: [],
  currentValues: Object.fromEntries(channels.map((channel) => [channel.id, 0])),
  previousPixels: null,
  audioContext: null,
  audioAnalyser: null,
  audioData: null,
  mediaSource: null,
  lastFrameAt: 0,
  lastCanvasDrawAt: 0,
  lastAnalysisAt: 0,
  needsRedraw: true,
  hasAutoScrolled: false,
  samplingErrorShown: false,
};

const brainCtx = els.brainCanvas.getContext("2d");
const graphCtx = els.graphCanvas.getContext("2d");
const sampleCtx = els.sampleCanvas.getContext("2d", { willReadFrequently: true });

function createSeries(length) {
  const safeLength = Math.max(1, length);
  return Object.fromEntries(
    channels.map((channel) => [channel.id, Array(safeLength).fill(null)]),
  );
}

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : 0));
}

function mix(previous, next, amount) {
  return previous * (1 - amount) + next * amount;
}

function niceTick(value) {
  if (value <= 1) return 1;
  if (value <= 2) return 2;
  if (value <= 5) return 5;
  if (value <= 10) return 10;
  return Math.ceil(value / 10) * 10;
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return "0.0s";
  return `${seconds.toFixed(1)}s`;
}

function formatTimestamp(seconds) {
  const safeSeconds = Math.max(0, Math.floor(seconds || 0));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = String(safeSeconds % 60).padStart(2, "0");
  return `${minutes}:${remainder}`;
}

function currentSecond() {
  if (!state.duration) return 0;
  return Math.min(state.seconds - 1, Math.max(0, Math.floor(els.video.currentTime)));
}

function activeSeries() {
  return state.liveSeries;
}

function setBadge(element, text, tone = "ready") {
  element.textContent = text;
  element.dataset.tone = tone;
}

function scrollToTimeline() {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  els.timelinePanel.scrollIntoView({
    behavior: reduceMotion ? "auto" : "smooth",
    block: "start",
  });
}

function initMeters() {
  els.channelMeters.innerHTML = "";
  for (const channel of channels) {
    const meter = document.createElement("div");
    meter.className = "meter";
    meter.dataset.channel = channel.id;
    meter.innerHTML = `
      <div class="meter-top">
        <span class="meter-label">
          <span class="swatch" style="background:${channel.color}"></span>
          <span>${channel.label}</span>
          <button class="info-button" type="button" aria-expanded="false" aria-controls="info-${channel.id}" data-info="${channel.id}">?</button>
        </span>
        <span class="meter-value">0.00</span>
      </div>
      <div class="meter-track">
        <span class="meter-fill" style="background:${channel.color}"></span>
      </div>
      <p id="info-${channel.id}" class="info-popover" hidden>${channel.info}</p>
    `;
    els.channelMeters.appendChild(meter);
  }
}

function initGraphLegend() {
  els.graphLegend.innerHTML = "";
  const fragment = document.createDocumentFragment();
  for (const channel of channels) {
    const chip = document.createElement("span");
    chip.className = "legend-chip";
    chip.innerHTML = `
      <span class="swatch" style="background:${channel.color}"></span>
      <span>${channel.label}</span>
    `;
    fragment.append(chip);
  }
  els.graphLegend.append(fragment);
}

function updateMeters(values) {
  for (const channel of channels) {
    const meter = els.channelMeters.querySelector(`[data-channel="${channel.id}"]`);
    if (!meter) continue;
    const value = clamp(values[channel.id]);
    meter.querySelector(".meter-value").textContent = value.toFixed(2);
    meter.querySelector(".meter-fill").style.width = `${Math.round(value * 100)}%`;
  }
}

function resetAnalysis(seconds) {
  state.seconds = Math.max(1, Math.ceil(seconds || 1));
  state.duration = seconds || 0;
  state.liveSeries = createSeries(state.seconds);
  state.featureSeries = Array(state.seconds).fill(null);
  state.counts = Array(state.seconds).fill(0);
  state.previousPixels = null;
  state.currentValues = Object.fromEntries(channels.map((channel) => [channel.id, 0]));
  state.needsRedraw = true;
  buildSecondRail();
  updateStatus();
  renderAnalysis(true);
}

function buildSecondRail() {
  els.secondRail.innerHTML = "";
  const visibleCells = Math.min(state.seconds, 180);
  for (let index = 0; index < visibleCells; index += 1) {
    const cell = document.createElement("span");
    cell.className = "second-cell";
    cell.dataset.index = String(index);
    els.secondRail.appendChild(cell);
  }
}

function updateSecondRail() {
  const active = currentSecond();
  const cells = els.secondRail.querySelectorAll(".second-cell");
  cells.forEach((cell) => {
    const index = Number(cell.dataset.index);
    cell.classList.toggle("is-seen", hasAnyValue(index));
    cell.classList.toggle("is-active", index === active);
  });
}

function hasAnyValue(index) {
  const series = activeSeries();
  return channels.some((channel) => series[channel.id]?.[index] != null);
}

async function loadVideoFile(file) {
  if (!file) return;
  if (state.videoUrl) URL.revokeObjectURL(state.videoUrl);
  state.videoUrl = URL.createObjectURL(file);
  state.sourceName = file.name;
  state.mode = "demo";
  state.previousPixels = null;
  state.samplingErrorShown = false;
  state.hasAutoScrolled = false;
  els.dropZone.classList.remove("is-portrait");
  els.video.src = state.videoUrl;
  els.video.load();
  resetAnalysis(0);
  els.emptyState.classList.add("is-hidden");
  els.videoName.textContent = file.name;
  setBadge(els.modeBadge, "Ready to read", "ready");
  els.playButton.disabled = false;
  els.resetButton.disabled = false;
  els.videoInput.value = "";
}

function setupAudioAnalyser() {
  if (state.audioAnalyser || !els.video.src) return;
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    state.audioContext = new AudioContext();
    state.audioAnalyser = state.audioContext.createAnalyser();
    state.audioAnalyser.fftSize = 512;
    state.audioData = new Uint8Array(state.audioAnalyser.frequencyBinCount);
    state.mediaSource = state.audioContext.createMediaElementSource(els.video);
    state.mediaSource.connect(state.audioAnalyser);
    state.audioAnalyser.connect(state.audioContext.destination);
  } catch (error) {
    console.warn("Audio analysis unavailable", error);
    state.audioAnalyser = null;
  }
}

function getAudioLevel() {
  if (!state.audioAnalyser || !state.audioData) return 0;
  state.audioAnalyser.getByteFrequencyData(state.audioData);
  let sum = 0;
  for (let index = 0; index < state.audioData.length; index += 1) {
    sum += state.audioData[index] / 255;
  }
  return clamp(sum / state.audioData.length);
}

function sampleVideoFeatures() {
  if (els.video.readyState < 2 || els.video.videoWidth === 0) {
    return null;
  }

  const width = els.sampleCanvas.width;
  const height = els.sampleCanvas.height;
  sampleCtx.drawImage(els.video, 0, 0, width, height);
  const frame = sampleCtx.getImageData(0, 0, width, height).data;
  const hadPreviousPixels = Boolean(state.previousPixels);
  let brightness = 0;
  let saturation = 0;
  let redBias = 0;
  let blueBias = 0;
  let contrastSum = 0;
  let motion = 0;
  let count = 0;

  for (let pixel = 0; pixel < frame.length; pixel += 16) {
    const r = frame[pixel] / 255;
    const g = frame[pixel + 1] / 255;
    const b = frame[pixel + 2] / 255;
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    brightness += luma;
    saturation += max === 0 ? 0 : (max - min) / max;
    redBias += Math.max(0, r - (g + b) / 2);
    blueBias += Math.max(0, b - (r + g) / 2);
    contrastSum += Math.abs(luma - 0.5) * 2;
    if (state.previousPixels) {
      const pr = state.previousPixels[pixel] / 255;
      const pg = state.previousPixels[pixel + 1] / 255;
      const pb = state.previousPixels[pixel + 2] / 255;
      motion += (Math.abs(r - pr) + Math.abs(g - pg) + Math.abs(b - pb)) / 3;
    }
    count += 1;
  }

  state.previousPixels = new Uint8ClampedArray(frame);
  const audio = getAudioLevel();
  const base = {
    brightness: brightness / count,
    saturation: saturation / count,
    redBias: redBias / count,
    blueBias: blueBias / count,
    contrast: contrastSum / count,
    motion: hadPreviousPixels ? motion / count : 0,
    audio,
  };

  const t = els.video.currentTime || 0;
  return {
    visual: clamp(0.18 + base.saturation * 0.42 + base.motion * 1.9 + base.contrast * 0.18),
    auditory: clamp(0.1 + base.audio * 1.75 + Math.sin(t * 3.1) * 0.025),
    language: clamp(0.12 + base.audio * 0.92 + base.blueBias * 0.36 + Math.sin(t * 1.7) * 0.06),
    attention: clamp(0.2 + base.motion * 2.2 + base.contrast * 0.28 + base.saturation * 0.16),
    motor: clamp(0.08 + base.motion * 2.65 + Math.max(0, Math.sin(t * 4.2)) * 0.08),
    salience: clamp(0.1 + base.redBias * 1.8 + base.audio * 0.55 + base.motion * 1.1),
    default: clamp(0.68 - base.motion * 1.4 - base.audio * 0.42 + (1 - base.contrast) * 0.1),
    metrics: base,
  };
}

function safelySampleVideoFeatures() {
  try {
    return sampleVideoFeatures();
  } catch (error) {
    if (!state.samplingErrorShown) {
      console.warn("Frame analysis unavailable", error);
      state.samplingErrorShown = true;
    }
    return null;
  }
}

function absorbLiveValues(values) {
  if (!values || state.mode !== "demo") return;
  const second = Math.min(state.seconds - 1, Math.max(0, Math.floor(els.video.currentTime)));
  const seen = state.counts[second] || 0;
  state.counts[second] = seen + 1;
  absorbFeatureValues(second, values.metrics, seen);

  for (const channel of channels) {
    const previous = state.liveSeries[channel.id][second];
    const next = clamp(values[channel.id]);
    state.liveSeries[channel.id][second] =
      previous == null ? next : mix(previous, next, 1 / Math.min(seen + 1, 12));
    state.currentValues[channel.id] = mix(state.currentValues[channel.id] || 0, next, 0.24);
  }
}

function absorbFeatureValues(second, metrics, seen) {
  if (!metrics) return;
  const previous = state.featureSeries[second];
  const amount = previous == null ? 1 : 1 / Math.min(seen + 1, 12);
  const next = {};
  for (const key of ["brightness", "saturation", "redBias", "blueBias", "contrast", "motion", "audio"]) {
    next[key] = previous == null ? metrics[key] : mix(previous[key] || 0, metrics[key] || 0, amount);
  }
  state.featureSeries[second] = next;
}

function updateCurrentValuesFromSeries() {
  const second = Math.min(state.seconds - 1, currentSecond());
  const series = activeSeries();
  for (const channel of channels) {
    const value = series[channel.id]?.[second];
    if (value != null) {
      state.currentValues[channel.id] = mix(state.currentValues[channel.id] || 0, value, 0.38);
    }
  }
}

function updateStatus() {
  const duration = state.duration || els.video.duration || 0;
  const active = currentSecond();
  els.currentTime.textContent = formatTime(els.video.currentTime || 0);
  els.duration.textContent = formatTime(duration);
  els.activeSecond.textContent = `Second ${active}`;
  els.trCount.textContent = `${state.seconds || 0} TRs`;
}

function updateVideoFrameAspect() {
  const width = els.video.videoWidth || 0;
  const height = els.video.videoHeight || 0;
  els.dropZone.classList.toggle("is-portrait", height > width * 1.08);
}

function setTimelineLoading(isLoading) {
  els.timelinePanel.classList.toggle("is-loading", isLoading);
}

function renderAnalysis(force = false) {
  const now = performance.now();
  if (!force && now - state.lastAnalysisAt < 650) return;
  state.lastAnalysisAt = now;

  const rows = getObservedRows();
  const isReadingFirstSeconds = !els.video.paused && rows.length < Math.min(2, state.seconds);
  setTimelineLoading(isReadingFirstSeconds);
  els.analysisPanel.classList.toggle("is-loading", isReadingFirstSeconds);
  if (rows.length === 0) {
    const isReading = Boolean(els.video.src) && !els.video.paused;
    setBadge(els.analysisBadge, isReading ? "Reading first seconds" : "Waiting for playback", isReading ? "active" : "ready");
    els.engagementScore.textContent = "--";
    els.engagementVerdict.textContent = isReading ? "Reading signal" : "Play the video";
    els.engagementSummary.textContent =
      "Play a video to see simple notes about where attention rises, where it drops, and what to improve.";
    renderTimestampItems([
      {
        start: 0,
        end: 0,
        title: "No analysed seconds yet",
        body: "The readout will populate from the live visual, audio, and activity signals.",
      },
    ]);
    renderList(els.improvementList, ["Play through the creative once to build recommendations."]);
    renderList(els.campaignList, ["Campaign fit appears after the first analysed seconds."]);
    return;
  }

  const score = average(rows.map((row) => row.engagement));
  const verdict = engagementVerdict(score);
  const observedLabel = `${rows.length}/${state.seconds} seconds read`;
  setBadge(els.analysisBadge, observedLabel, els.video.paused ? "ready" : "active");
  els.engagementScore.textContent = String(Math.round(score * 100));
  els.engagementVerdict.textContent = verdict.label;
  els.engagementSummary.textContent = buildEngagementSummary(rows, score, verdict);
  renderTimestampItems(buildTimestampSegments(rows));
  renderList(els.improvementList, buildImprovements(rows, score));
  renderList(els.campaignList, buildCampaignFits(rows, score));
}

function getObservedRows() {
  const rows = [];
  const series = activeSeries();
  for (let second = 0; second < state.seconds; second += 1) {
    if (!state.counts[second] || !hasAnyValue(second)) continue;
    const values = Object.fromEntries(
      channels.map((channel) => [channel.id, clamp(series[channel.id]?.[second])]),
    );
    const metrics = state.featureSeries[second] || {};
    const motionSignal = clamp((metrics.motion || 0) * 7);
    const audioSignal = clamp((metrics.audio || 0) * 2.4);
    const engagement = clamp(
      0.15 +
        values.attention * 0.25 +
        values.salience * 0.2 +
        values.visual * 0.16 +
        values.auditory * 0.14 +
        values.motor * 0.1 +
        values.language * 0.07 +
        motionSignal * 0.08 +
        audioSignal * 0.05 -
        values.default * 0.15,
    );
    const dominant = channels.reduce((best, channel) => {
      return values[channel.id] > values[best.id] ? channel : best;
    }, channels[0]);
    rows.push({ second, values, metrics, motionSignal, audioSignal, engagement, dominant });
  }
  return rows;
}

function engagementVerdict(score) {
  if (score >= 0.74) return { label: "Strong watch potential", tone: "strong" };
  if (score >= 0.58) return { label: "Good, with room to sharpen", tone: "promising" };
  if (score >= 0.42) return { label: "Needs a stronger hook", tone: "soft" };
  return { label: "Likely to lose viewers", tone: "low" };
}

function buildEngagementSummary(rows, score, verdict) {
  const firstThree = rows.filter((row) => row.second < 3);
  const firstScore = firstThree.length ? average(firstThree.map((row) => row.engagement)) : score;
  const peak = maxBy(rows, (row) => row.engagement);
  const audio = average(rows.map((row) => row.audioSignal));
  const motion = average(rows.map((row) => row.motionSignal));
  const opening = firstScore >= 0.58 ? "The first few seconds are doing enough to keep people watching." : "The first few seconds need a clearer reason to keep watching.";
  const driver = motion > audio ? "The video is mainly helped by visual movement." : "The video is mainly helped by sound, voice, or rhythm.";
  return `${verdict.label}. ${opening} ${driver} The strongest moment appears around ${formatTimestamp(peak.second)}.`;
}

function buildTimestampSegments(rows) {
  const segments = [];
  for (const row of rows) {
    const moment = classifyMoment(row);
    const previous = segments[segments.length - 1];
    if (previous && previous.key === moment.key && row.second <= previous.end + 1) {
      previous.end = row.second;
      previous.engagement = Math.max(previous.engagement, row.engagement);
      continue;
    }
    segments.push({
      key: moment.key,
      start: row.second,
      end: row.second,
      engagement: row.engagement,
      title: moment.title,
      body: moment.body,
    });
  }

  if (segments.length <= 6) return segments;
  const strongest = [...segments].sort((a, b) => b.engagement - a.engagement).slice(0, 6);
  return strongest.sort((a, b) => a.start - b.start);
}

function classifyMoment(row) {
  const { values, motionSignal, audioSignal, engagement } = row;
  if (engagement >= 0.72 && motionSignal >= 0.35) {
    return {
      key: "peak-motion",
      title: "Strong attention moment",
      body: "This section has movement and contrast. Put the product, offer, or payoff close to moments like this.",
    };
  }
  if (audioSignal >= 0.5 && values.language >= 0.36) {
    return {
      key: "audio-message",
      title: "Sound-led moment",
      body: "Sound or voice is doing the work here. Add captions so the message still lands when sound is off.",
    };
  }
  if (values.attention >= 0.52 && values.visual >= 0.38) {
    return {
      key: "visual-lift",
      title: "Good visual lift",
      body: "The frame is changing enough to pull focus. Make sure the viewer can quickly understand what they are seeing.",
    };
  }
  if (values.salience >= 0.42) {
    return {
      key: "salience-spike",
      title: "Standout beat",
      body: "This part stands out. It can support a reveal, before-after moment, price cue, or call to action.",
    };
  }
  if (values.default >= 0.58 && engagement < 0.48) {
    return {
      key: "low-change",
      title: "Slow stretch",
      body: "This part may feel flat. Trim it, add a visual change, or add text that gives people a reason to stay.",
    };
  }
  return {
    key: "steady",
    title: "Steady moment",
    body: `This section is stable. The ${row.dominant.label.toLowerCase()} signal is strongest here.`,
  };
}

function buildImprovements(rows, score) {
  const firstRows = rows.filter((row) => row.second < 3);
  const firstScore = firstRows.length ? average(firstRows.map((row) => row.engagement)) : score;
  const attention = average(rows.map((row) => row.values.attention));
  const salience = average(rows.map((row) => row.values.salience));
  const defaultMode = average(rows.map((row) => row.values.default));
  const audio = average(rows.map((row) => row.audioSignal));
  const motion = average(rows.map((row) => row.motionSignal));
  const items = [];

  if (firstScore < 0.58) {
    items.push("Show the most interesting visual, line, or result in the first 2 seconds.");
  }
  if (motion < 0.28 && attention < 0.5) {
    items.push("Add one clear change: a tighter cut, camera move, product reveal, or before-after switch.");
  }
  if (audio < 0.32) {
    items.push("Add stronger sound or captions so the promise is clear with sound on or off.");
  }
  if (defaultMode > 0.55 || salience < 0.32) {
    items.push("Trim slow parts and move the offer or transformation closer to the strongest moments.");
  }
  if (score >= 0.68) {
    items.push("Keep the core edit, then test two different opening hooks.");
  }
  if (items.length === 0) {
    items.push("Make the hook clearer, keep the strongest proof point, and end with a direct next step.");
  }
  return items.slice(0, 4);
}

function buildCampaignFits(rows, score) {
  const visual = average(rows.map((row) => row.values.visual));
  const audio = average(rows.map((row) => row.audioSignal));
  const language = average(rows.map((row) => row.values.language));
  const salience = average(rows.map((row) => row.values.salience));
  const motion = average(rows.map((row) => row.motionSignal));
  const fits = [];

  if (visual > 0.38 && motion > 0.28) {
    fits.push("Awareness ads where fast visual proof matters.");
  }
  if (audio > 0.38 || language > 0.34) {
    fits.push("Creator testimonial or explainer with strong captions.");
  }
  if (salience > 0.38) {
    fits.push("Launch, product drop, limited-time offer, or before-after story.");
  }
  if (score < 0.5) {
    fits.push("Use for retargeting only after the opening is tighter.");
  } else {
    fits.push("A/B test as paid social with different hooks, captions, and calls to action.");
  }
  return fits.slice(0, 4);
}

function renderTimestampItems(items) {
  els.timestampInsights.innerHTML = "";
  const fragment = document.createDocumentFragment();
  for (const item of items) {
    const row = document.createElement("div");
    row.className = "timestamp-item";

    const time = document.createElement("span");
    time.className = "timestamp-time";
    time.textContent =
      item.start === item.end
        ? formatTimestamp(item.start)
        : `${formatTimestamp(item.start)}-${formatTimestamp(item.end + 1)}`;

    const copy = document.createElement("div");
    copy.className = "timestamp-copy";
    const title = document.createElement("strong");
    title.textContent = item.title;
    const body = document.createElement("span");
    body.textContent = item.body;
    copy.append(title, body);
    row.append(time, copy);
    fragment.append(row);
  }
  els.timestampInsights.append(fragment);
}

function renderList(element, items) {
  element.innerHTML = "";
  const fragment = document.createDocumentFragment();
  for (const item of items) {
    const li = document.createElement("li");
    li.textContent = item;
    fragment.append(li);
  }
  element.append(fragment);
}

function average(values) {
  const valid = values.filter((value) => Number.isFinite(value));
  if (valid.length === 0) return 0;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function maxBy(items, score) {
  return items.reduce((best, item) => (score(item) > score(best) ? item : best), items[0]);
}

function drawBrain(values) {
  const canvas = els.brainCanvas;
  const ctx = brainCtx;
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);

  ctx.fillStyle = "#071829";
  ctx.fillRect(0, 0, width, height);
  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = "#edfce9";
  const grid = Math.max(12, Math.floor(width / 34));
  for (let x = grid; x < width; x += grid) {
    for (let y = grid; y < height; y += grid) {
      ctx.fillRect(x, y, 2, 2);
    }
  }
  ctx.restore();

  drawHemisphere(ctx, width * 0.36, height * 0.5, width * 0.34, height * 0.72, -1);
  drawHemisphere(ctx, width * 0.64, height * 0.5, width * 0.34, height * 0.72, 1);
  drawMidline(ctx, width, height);

  const spots = [
    ["visual", 0.27, 0.62, 0.18],
    ["visual", 0.73, 0.62, 0.18],
    ["auditory", 0.31, 0.55, 0.14],
    ["auditory", 0.69, 0.55, 0.14],
    ["language", 0.34, 0.38, 0.13],
    ["attention", 0.48, 0.28, 0.17],
    ["attention", 0.56, 0.3, 0.15],
    ["motor", 0.5, 0.48, 0.16],
    ["salience", 0.43, 0.42, 0.14],
    ["salience", 0.59, 0.44, 0.12],
    ["default", 0.49, 0.66, 0.18],
  ];

  for (const [id, x, y, radius] of spots) {
    const channel = channels.find((item) => item.id === id);
    const value = clamp(values[id]);
    if (value <= 0.01) continue;
    drawBlob(ctx, x * width, y * height, radius * width * (0.72 + value * 0.62), channel.color, value);
  }

  ctx.save();
  ctx.globalAlpha = 0.46;
  ctx.strokeStyle = "rgba(237, 252, 233, 0.72)";
  ctx.lineWidth = 1.2;
  drawSulci(ctx, width, height);
  ctx.restore();
}

function drawHemisphere(ctx, cx, cy, w, h, side) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(side, 1);
  ctx.beginPath();
  ctx.moveTo(-w * 0.08, -h * 0.47);
  ctx.bezierCurveTo(-w * 0.44, -h * 0.45, -w * 0.58, -h * 0.22, -w * 0.55, h * 0.05);
  ctx.bezierCurveTo(-w * 0.63, h * 0.22, -w * 0.39, h * 0.48, -w * 0.06, h * 0.5);
  ctx.bezierCurveTo(w * 0.36, h * 0.52, w * 0.56, h * 0.25, w * 0.5, -h * 0.04);
  ctx.bezierCurveTo(w * 0.57, -h * 0.3, w * 0.28, -h * 0.52, -w * 0.08, -h * 0.47);
  ctx.closePath();
  const gradient = ctx.createLinearGradient(-w * 0.55, -h * 0.5, w * 0.55, h * 0.5);
  gradient.addColorStop(0, "rgba(0, 60, 51, 0.9)");
  gradient.addColorStop(0.48, "rgba(7, 24, 41, 0.94)");
  gradient.addColorStop(1, "rgba(0, 143, 122, 0.56)");
  ctx.fillStyle = gradient;
  ctx.shadowColor = "rgba(0, 0, 0, 0.38)";
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 12;
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.strokeStyle = "rgba(237, 252, 233, 0.46)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

function drawMidline(ctx, width, height) {
  ctx.save();
  ctx.strokeStyle = "rgba(237, 252, 233, 0.35)";
  ctx.lineWidth = 2;
  ctx.setLineDash([7, 8]);
  ctx.beginPath();
  ctx.moveTo(width * 0.5, height * 0.15);
  ctx.bezierCurveTo(width * 0.48, height * 0.34, width * 0.52, height * 0.62, width * 0.49, height * 0.86);
  ctx.stroke();
  ctx.restore();
}

function drawSulci(ctx, width, height) {
  const curves = [
    [0.22, 0.33, 0.36, 0.22, 0.43, 0.42, 0.31, 0.5],
    [0.21, 0.52, 0.34, 0.42, 0.42, 0.57, 0.3, 0.7],
    [0.59, 0.34, 0.7, 0.22, 0.82, 0.4, 0.72, 0.52],
    [0.58, 0.55, 0.68, 0.44, 0.84, 0.58, 0.72, 0.73],
    [0.39, 0.24, 0.47, 0.36, 0.42, 0.53, 0.49, 0.72],
    [0.61, 0.25, 0.52, 0.37, 0.59, 0.54, 0.52, 0.73],
  ];
  for (const curve of curves) {
    ctx.beginPath();
    ctx.moveTo(curve[0] * width, curve[1] * height);
    ctx.bezierCurveTo(
      curve[2] * width,
      curve[3] * height,
      curve[4] * width,
      curve[5] * height,
      curve[6] * width,
      curve[7] * height,
    );
    ctx.stroke();
  }
}

function drawBlob(ctx, x, y, radius, color, value) {
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, colorWithAlpha(color, 0.9 * value));
  gradient.addColorStop(0.42, colorWithAlpha(color, 0.45 * value));
  gradient.addColorStop(1, colorWithAlpha(color, 0));
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function colorWithAlpha(hex, alpha) {
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${clamp(alpha)})`;
}

function drawGraph() {
  const canvas = els.graphCanvas;
  const ctx = graphCtx;
  const width = canvas.width;
  const height = canvas.height;
  const ratio = window.devicePixelRatio || 1;
  const padding = {
    left: 48 * ratio,
    right: 18 * ratio,
    top: 24 * ratio,
    bottom: 34 * ratio,
  };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const series = activeSeries();
  const seconds = Math.max(1, state.seconds);
  const current = els.video.currentTime || 0;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#fffdfa";
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "rgba(0, 60, 51, 0.13)";
  ctx.lineWidth = 1;
  ctx.font = `${12 * ratio}px Inter, system-ui, sans-serif`;
  ctx.fillStyle = "#616161";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";

  for (let step = 0; step <= 4; step += 1) {
    const y = padding.top + plotHeight * (step / 4);
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
    const label = (1 - step / 4).toFixed(2);
    ctx.fillText(label, padding.left - 10, y);
  }

  const maxTicks = Math.max(2, Math.floor(plotWidth / (92 * ratio)));
  const tickEvery = niceTick(Math.ceil(seconds / maxTicks));
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (let second = 0; second <= seconds; second += tickEvery) {
    const x = padding.left + (second / seconds) * plotWidth;
    ctx.strokeStyle = second % (tickEvery * 2) === 0 ? "rgba(0, 60, 51, 0.18)" : "rgba(0, 60, 51, 0.08)";
    ctx.beginPath();
    ctx.moveTo(x, padding.top);
    ctx.lineTo(x, padding.top + plotHeight);
    ctx.stroke();
    ctx.fillStyle = "#6d767f";
    ctx.fillText(`${second}s`, x, padding.top + plotHeight + 12);
  }

  for (const channel of channels) {
    const values = series[channel.id] || [];
    ctx.strokeStyle = channel.color;
    ctx.lineWidth = 2.5 * ratio;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    let started = false;
    for (let second = 0; second < seconds; second += 1) {
      const value = values[second];
      if (value == null) {
        started = false;
        continue;
      }
      const x = padding.left + ((second + 0.5) / seconds) * plotWidth;
      const y = padding.top + (1 - clamp(value)) * plotHeight;
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
  }

  const cursorX = padding.left + (clamp(current / Math.max(state.duration, 1)) * plotWidth);
  ctx.save();
  ctx.strokeStyle = "#17171c";
  ctx.lineWidth = 1.5 * ratio;
  ctx.beginPath();
  ctx.moveTo(cursorX, padding.top - 4);
  ctx.lineTo(cursorX, padding.top + plotHeight + 4);
  ctx.stroke();
  ctx.fillStyle = "#ff7759";
  ctx.beginPath();
  ctx.arc(cursorX, padding.top + 8 * ratio, 4 * ratio, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function resizeCanvasToDisplaySize(canvas) {
  const ratio = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.floor(rect.width * ratio));
  const height = Math.max(1, Math.floor(rect.height * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
}

function draw() {
  const now = performance.now();
  if (!els.video.paused) {
    if (now - state.lastFrameAt > 85) {
      state.lastFrameAt = now;
      absorbLiveValues(safelySampleVideoFeatures());
      state.needsRedraw = true;
    }
  }

  const redrawEvery = els.video.paused ? 180 : 50;
  if (state.needsRedraw || now - state.lastCanvasDrawAt > redrawEvery) {
    state.lastCanvasDrawAt = now;
    state.needsRedraw = false;
    resizeCanvasToDisplaySize(els.brainCanvas);
    resizeCanvasToDisplaySize(els.graphCanvas);
    updateCurrentValuesFromSeries();
    updateMeters(state.currentValues);
    drawBrain(state.currentValues);
    drawGraph();
    updateStatus();
    updateSecondRail();
    renderAnalysis();
  }
  requestAnimationFrame(draw);
}

els.videoInput.addEventListener("change", (event) => {
  loadVideoFile(event.target.files?.[0]);
});

els.playButton.addEventListener("click", async () => {
  try {
    if (els.video.paused) {
      setupAudioAnalyser();
      if (state.audioContext?.state === "suspended") {
        await state.audioContext.resume();
      }
      await els.video.play();
      if (!state.hasAutoScrolled) {
        state.hasAutoScrolled = true;
        requestAnimationFrame(scrollToTimeline);
      }
    } else {
      els.video.pause();
    }
  } catch (error) {
    console.error("Video playback failed", error);
    setBadge(els.modeBadge, "Playback error", "error");
  }
});

els.resetButton.addEventListener("click", () => {
  els.video.pause();
  els.video.currentTime = 0;
  resetAnalysis(els.video.duration || state.duration);
});

els.video.addEventListener("loadedmetadata", () => {
  state.samplingErrorShown = false;
  updateVideoFrameAspect();
  resetAnalysis(els.video.duration);
  els.duration.textContent = formatTime(els.video.duration);
  els.videoName.textContent = state.sourceName;
});

els.video.addEventListener("play", () => {
  els.playButton.textContent = "Pause";
  setBadge(els.modeBadge, "Reading signal", "active");
  setupAudioAnalyser();
});

els.video.addEventListener("pause", () => {
  els.playButton.textContent = "Play";
  if (!els.video.ended && els.video.src) {
    setBadge(els.modeBadge, "Paused", "ready");
  }
});

els.video.addEventListener("ended", () => {
  els.playButton.textContent = "Play";
  setBadge(els.modeBadge, "Read complete", "ready");
  setTimelineLoading(false);
  els.analysisPanel.classList.remove("is-loading");
});

els.video.addEventListener("error", () => {
  console.error("Video element error", els.video.error);
  setBadge(els.modeBadge, "Video error", "error");
  setTimelineLoading(false);
  els.analysisPanel.classList.remove("is-loading");
});

["dragenter", "dragover"].forEach((eventName) => {
  els.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    els.dropZone.classList.add("drag-over");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  els.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    els.dropZone.classList.remove("drag-over");
  });
});

els.dropZone.addEventListener("drop", (event) => {
  const file = [...(event.dataTransfer?.files || [])].find((item) => item.type.startsWith("video/"));
  loadVideoFile(file);
});

els.channelMeters.addEventListener("click", (event) => {
  const button = event.target.closest(".info-button");
  if (!button) return;
  const meter = button.closest(".meter");
  const popover = meter.querySelector(".info-popover");
  const shouldOpen = !meter.classList.contains("is-info-open");
  for (const openMeter of els.channelMeters.querySelectorAll(".meter.is-info-open")) {
    openMeter.classList.remove("is-info-open");
    openMeter.querySelector(".info-button")?.setAttribute("aria-expanded", "false");
    const openPopover = openMeter.querySelector(".info-popover");
    if (openPopover) openPopover.hidden = true;
  }
  meter.classList.toggle("is-info-open", shouldOpen);
  button.setAttribute("aria-expanded", String(shouldOpen));
  popover.hidden = !shouldOpen;
});

window.addEventListener("resize", () => {
  state.needsRedraw = true;
});

initMeters();
initGraphLegend();
resetAnalysis(0);
draw();
