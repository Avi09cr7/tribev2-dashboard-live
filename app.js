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
  brainStage: document.getElementById("brainStage"),
  brainModelStatus: document.getElementById("brainModelStatus"),
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

const graphCtx = els.graphCanvas.getContext("2d");
const sampleCtx = els.sampleCanvas.getContext("2d", { willReadFrequently: true });

const brainModelPath = "assets/models/nih-human-brain.glb";
const brainModelRemoteFallback = "https://raw.githubusercontent.com/Avi09cr7/tribev2-dashboard-live/main/assets/models/nih-human-brain.glb";
const brainTargets = Object.fromEntries(channels.map((channel) => [channel.id, 0]));
const brainViz = {
  THREE: null,
  renderer: null,
  scene: null,
  camera: null,
  root: null,
  model: null,
  modelBaseScale: 1,
  current: { ...brainTargets },
  target: { ...brainTargets },
  hotspots: [],
  signalLinks: [],
  particles: null,
  ready: false,
  loading: false,
  failed: false,
  startTime: performance.now(),
  lastFrameAt: performance.now(),
  pointer: {
    dragging: false,
    lastX: 0,
    lastY: 0,
    rotationX: -0.12,
    rotationY: -0.28,
    velocityX: 0,
    velocityY: 0,
  },
};

window.__tribeBrainViz = brainViz;

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
  const profile = buildAnalysisProfile(rows, score);
  const observedLabel = `${rows.length}/${state.seconds} seconds read`;
  setBadge(els.analysisBadge, observedLabel, els.video.paused ? "ready" : "active");
  els.engagementScore.textContent = String(Math.round(score * 100));
  els.engagementVerdict.textContent = verdict.label;
  els.engagementSummary.textContent = buildEngagementSummary(rows, score, verdict, profile);
  renderTimestampItems(buildTimestampSegments(rows, profile));
  renderList(els.improvementList, buildImprovements(rows, score, profile));
  renderList(els.campaignList, buildCampaignFits(rows, score, profile));
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

function buildAnalysisProfile(rows, score) {
  const firstRows = rows.filter((row) => row.second < 3);
  const openingRows = firstRows.length ? firstRows : rows.slice(0, Math.min(3, rows.length));
  const finishRows = rows.slice(Math.max(0, rows.length - Math.min(3, rows.length)));
  const averages = Object.fromEntries(
    channels.map((channel) => [channel.id, average(rows.map((row) => row.values[channel.id]))]),
  );
  const metricAverages = Object.fromEntries(
    ["brightness", "saturation", "redBias", "blueBias", "contrast", "motion", "audio"].map((key) => [
      key,
      average(rows.map((row) => row.metrics[key] || 0)),
    ]),
  );
  const peak = maxBy(rows, (row) => row.engagement);
  const low = minBy(rows, (row) => row.engagement);
  const motionPeak = maxBy(rows, (row) => row.motionSignal + row.values.visual * 0.25);
  const audioPeak = maxBy(rows, (row) => row.audioSignal + row.values.language * 0.28);
  const saliencePeak = maxBy(rows, (row) => row.values.salience);
  const defaultPeak = maxBy(rows, (row) => row.values.default);
  const openingScore = average(openingRows.map((row) => row.engagement));
  const finishScore = average(finishRows.map((row) => row.engagement));
  const deltas = rows.slice(1).map((row, index) => Math.abs(row.engagement - rows[index].engagement));
  const dominantAverage = channels.reduce((best, channel) => {
    return averages[channel.id] > averages[best.id] ? channel : best;
  }, channels[0]);
  const profile = {
    score,
    averages,
    metricAverages,
    peak,
    low,
    motionPeak,
    audioPeak,
    saliencePeak,
    defaultPeak,
    openingScore,
    finishScore,
    trend: finishScore - openingScore,
    engagementRange: peak.engagement - low.engagement,
    volatility: average(deltas),
    visualEnergy: average(rows.map((row) => (row.values.visual + row.values.attention + row.motionSignal) / 3)),
    messageEnergy: average(rows.map((row) => (row.values.language + row.audioSignal) / 2)),
    dominantAverage,
  };
  profile.primaryDriver = describeProfileDriver(profile);
  return profile;
}

function engagementVerdict(score) {
  if (score >= 0.74) return { label: "Strong watch potential", tone: "strong" };
  if (score >= 0.58) return { label: "Good, with room to sharpen", tone: "promising" };
  if (score >= 0.42) return { label: "Needs a stronger hook", tone: "soft" };
  return { label: "Likely to lose viewers", tone: "low" };
}

function describeProfileDriver(profile) {
  if (profile.messageEnergy > profile.visualEnergy + 0.08) return "sound, voice, or message clarity";
  if (profile.visualEnergy > profile.messageEnergy + 0.08) return "movement and visual change";
  if (profile.averages.salience > 0.4) return "standout beats and contrast";
  if (profile.averages.default > 0.58) return "steady pacing, which may need a clearer story";
  return profile.dominantAverage.label.toLowerCase();
}

function describeRowDriver(row) {
  const candidates = [
    ["movement", row.motionSignal],
    ["sound or voice", row.audioSignal],
    ["visual change", row.values.visual],
    ["message density", row.values.language],
    ["standout contrast", row.values.salience],
    ["steady pacing", row.values.default],
  ];
  return candidates.reduce((best, item) => (item[1] > best[1] ? item : best), candidates[0])[0];
}

function describeLowReason(row) {
  if (row.values.default > 0.58) return "the signal is quiet and steady";
  if (row.motionSignal < 0.22) return "movement is low";
  if (row.audioSignal < 0.2 && row.values.language < 0.28) return "sound and message cues are light";
  if (row.values.salience < 0.28) return "there is not much contrast or novelty";
  return "the main attention signals flatten out";
}

function expandTimestampWindow(rows, targetSecond, predicate, maxRadius = 2) {
  const bySecond = new Map(rows.map((row) => [row.second, row]));
  let start = targetSecond;
  let end = targetSecond;
  while (bySecond.has(start - 1) && targetSecond - (start - 1) <= maxRadius && predicate(bySecond.get(start - 1))) {
    start -= 1;
  }
  while (bySecond.has(end + 1) && end + 1 - targetSecond <= maxRadius && predicate(bySecond.get(end + 1))) {
    end += 1;
  }
  return { start, end };
}

function pushTimestampItem(items, rows, row, key, title, body, predicate, maxRadius = 2) {
  if (!row || items.some((item) => item.key === key)) return;
  const range = expandTimestampWindow(rows, row.second, predicate, maxRadius);
  items.push({
    key,
    start: range.start,
    end: range.end,
    engagement: row.engagement,
    title,
    body,
  });
}

function buildEngagementSummary(rows, score, verdict, profile) {
  const trendText =
    profile.trend >= 0.08
      ? `Engagement builds toward the end (${formatSignedPercent(profile.trend)}).`
      : profile.trend <= -0.08
        ? `Engagement fades by the end (${formatSignedPercent(profile.trend)}), so the close may need a stronger payoff.`
        : "Engagement stays fairly even across the observed seconds.";
  const riskText =
    profile.engagementRange >= 0.16
      ? `The weakest pocket is around ${formatTimestamp(profile.low.second)}, where ${describeLowReason(profile.low)}.`
      : "There is no sharp drop yet, so the next improvement is about making the best moment arrive sooner.";
  return `${verdict.label}. Average engagement is ${formatPercent(score)} and the opening is ${formatPercent(profile.openingScore)}. The main driver is ${profile.primaryDriver}; the strongest moment is around ${formatTimestamp(profile.peak.second)} at ${formatPercent(profile.peak.engagement)}. ${trendText} ${riskText}`;
}

function buildTimestampSegments(rows, profile) {
  const items = [];
  const openingRow = rows.find((row) => row.second < 3) || rows[0];
  const openingBody =
    profile.openingScore >= profile.score + 0.06
      ? `The opening is stronger than the video average. Keep the early ${describeRowDriver(openingRow)} clear and move the offer in quickly.`
      : profile.openingScore < 0.5
        ? `The hook starts soft at ${formatPercent(profile.openingScore)}. Show the result, conflict, or product proof sooner.`
        : `The opening is serviceable at ${formatPercent(profile.openingScore)}. It needs one sharper promise to stop the scroll.`;
  pushTimestampItem(
    items,
    rows,
    openingRow,
    "opening",
    "Opening hook",
    openingBody,
    (row) => row.second < 3,
    2,
  );

  pushTimestampItem(
    items,
    rows,
    profile.peak,
    "peak",
    "Best attention pocket",
    `This is the strongest observed beat at ${formatPercent(profile.peak.engagement)}. It is mainly driven by ${describeRowDriver(profile.peak)}, so this is a good place for the key proof point or offer.`,
    (row) => row.engagement >= Math.max(profile.score + 0.05, profile.peak.engagement - 0.08),
    2,
  );

  if (profile.engagementRange >= 0.1) {
    pushTimestampItem(
      items,
      rows,
      profile.low,
      "low",
      "Drop risk",
      `This is the weakest pocket at ${formatPercent(profile.low.engagement)} because ${describeLowReason(profile.low)}. Trim it or add a new visual or text cue.`,
      (row) => row.engagement <= Math.min(profile.score - 0.04, profile.low.engagement + 0.08),
      2,
    );
  } else if (profile.low.engagement < 0.48 || profile.averages.default > 0.58) {
    pushTimestampItem(
      items,
      rows,
      profile.defaultPeak,
      "low-energy",
      "Low energy stretch",
      `The observed section stays low at about ${formatPercent(profile.low.engagement)}-${formatPercent(profile.peak.engagement)}. Add a sharper hook, visual change, or clearer reason to keep watching.`,
      (row) => row.engagement < 0.5 || row.values.default > 0.58,
      3,
    );
  }

  if (profile.motionPeak.motionSignal >= 0.28 || profile.motionPeak.values.visual >= profile.averages.visual + 0.08) {
    pushTimestampItem(
      items,
      rows,
      profile.motionPeak,
      "motion",
      "Movement lift",
      `The visual pace rises here. Use this beat for a reveal, before-after switch, product motion, or creator gesture.`,
      (row) => row.motionSignal >= Math.max(0.24, profile.motionPeak.motionSignal - 0.12),
      1,
    );
  }

  if (profile.audioPeak.audioSignal >= 0.3 || profile.audioPeak.values.language >= 0.34) {
    pushTimestampItem(
      items,
      rows,
      profile.audioPeak,
      "audio",
      "Sound or message cue",
      `Audio/message energy peaks here. Add captions or a short on-screen phrase so the same idea works with sound off.`,
      (row) => row.audioSignal >= Math.max(0.24, profile.audioPeak.audioSignal - 0.12),
      1,
    );
  }

  if (profile.saliencePeak.values.salience >= Math.max(0.34, profile.averages.salience + 0.06)) {
    pushTimestampItem(
      items,
      rows,
      profile.saliencePeak,
      "salience",
      "Standout beat",
      `This moment has the clearest novelty spike. It can carry a price cue, product drop, transformation, or call to action.`,
      (row) => row.values.salience >= Math.max(0.3, profile.saliencePeak.values.salience - 0.08),
      1,
    );
  }

  if (rows.length >= 5) {
    const finishRow = rows[rows.length - 1];
    const finishBody =
      profile.trend <= -0.08
        ? `The ending is weaker than the opening. Move the call to action closer to ${formatTimestamp(profile.peak.second)} or end sooner.`
        : profile.trend >= 0.08
          ? "The video gains strength near the end. Bring a preview of this payoff into the first seconds."
          : "The close stays stable. Make sure the final frame gives one direct next step.";
    pushTimestampItem(
      items,
      rows,
      finishRow,
      "finish",
      "Ending read",
      finishBody,
      (row) => row.second >= finishRow.second - 2,
      2,
    );
  }

  if (items.length < 3) {
    for (const row of rows) {
      const moment = classifyMoment(row);
      pushTimestampItem(items, rows, row, `fallback-${moment.key}`, moment.title, moment.body, (item) => classifyMoment(item).key === moment.key, 1);
      if (items.length >= 3) break;
    }
  }

  return items
    .sort((a, b) => a.start - b.start || b.engagement - a.engagement)
    .slice(0, 6);
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

function buildImprovements(rows, score, profile) {
  const items = [];

  if (profile.openingScore < 0.56) {
    items.push(`Move the strongest moment from ${formatTimestamp(profile.peak.second)} into the first 2 seconds, or preview it with text.`);
  }
  if (profile.engagementRange >= 0.14) {
    items.push(`Fix the dip around ${formatTimestamp(profile.low.second)} by cutting faster or adding a new visual cue.`);
  }
  if (profile.visualEnergy < 0.38) {
    items.push("Add one obvious visual change: a tighter crop, camera move, product reveal, or before-after switch.");
  }
  if (profile.messageEnergy < 0.3) {
    items.push("Add a short caption or spoken promise so the viewer understands the point without guessing.");
  } else if (profile.messageEnergy > profile.visualEnergy + 0.12) {
    items.push("Keep captions on screen during the audio-led moments so the message survives silent viewing.");
  }
  if (profile.averages.salience < 0.32) {
    items.push("Create a clearer standout beat: transformation, price cue, surprising detail, or stronger contrast.");
  }
  if (profile.trend <= -0.08) {
    items.push("End earlier or move the call to action before the late drop.");
  } else if (profile.trend >= 0.08) {
    items.push("Bring a preview of the ending payoff into the opening hook.");
  }
  if (score >= 0.68 && profile.openingScore >= 0.58) {
    items.push("The base edit is working. Test two hooks: one benefit-led and one curiosity-led.");
  }
  if (items.length === 0) {
    items.push(`Keep the proof around ${formatTimestamp(profile.peak.second)}, make the hook more explicit, and end with one direct next step.`);
  }
  return items.slice(0, 4);
}

function buildCampaignFits(rows, score, profile) {
  const fits = [];

  if (profile.visualEnergy > 0.42 && profile.motionPeak.second <= 4) {
    fits.push("Cold awareness ads, especially if the opening frame shows the product or result immediately.");
  } else if (profile.visualEnergy > 0.42) {
    fits.push("Awareness edits after moving the strongest visual beat closer to the start.");
  }
  if (profile.messageEnergy > 0.36) {
    fits.push("Creator testimonial, explainer, or founder-led ad with large captions.");
  }
  if (profile.averages.salience > 0.36 || profile.saliencePeak.values.salience > 0.46) {
    fits.push("Launch, product drop, limited-time offer, or before-after creative.");
  }
  if (profile.averages.default > 0.58 && score < 0.58) {
    fits.push("Warm retargeting or landing-page support, not broad cold traffic yet.");
  }
  if (score < 0.5 || profile.openingScore < 0.48) {
    fits.push("Retargeting only until the first 2 seconds are sharper.");
  } else {
    fits.push("Paid social A/B test with different hooks, captions, and calls to action.");
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

function minBy(items, score) {
  return items.reduce((best, item) => (score(item) < score(best) ? item : best), items[0]);
}

function formatPercent(value) {
  return `${Math.round(clamp(value) * 100)}%`;
}

function formatSignedPercent(value) {
  const rounded = Math.round(value * 100);
  return `${rounded > 0 ? "+" : ""}${rounded}%`;
}

function setBrainStatus(status, message) {
  els.brainStage.dataset.status = status;
  if (message) {
    els.brainModelStatus.textContent = message;
  }
}

function updateBrainScene(values) {
  for (const channel of channels) {
    brainViz.target[channel.id] = clamp(values[channel.id]);
  }
}

async function initBrainScene() {
  if (brainViz.loading || brainViz.ready) return;
  brainViz.loading = true;
  setBrainStatus("loading", "Loading 3D brain");

  try {
    const [THREE, { GLTFLoader }] = await Promise.all([
      import("three"),
      import("three/addons/loaders/GLTFLoader.js"),
    ]);
    brainViz.THREE = THREE;

    const renderer = new THREE.WebGLRenderer({
      canvas: els.brainCanvas,
      alpha: true,
      antialias: true,
      powerPreference: "high-performance",
      preserveDrawingBuffer: true,
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.18;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    brainViz.renderer = renderer;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x03070d, 0.16);
    brainViz.scene = scene;

    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    camera.position.set(0, 0.06, 5.75);
    brainViz.camera = camera;

    const root = new THREE.Group();
    scene.add(root);
    brainViz.root = root;

    addBrainLighting(THREE, scene);
    addBrainBackdrop(THREE, scene);

    const loader = new GLTFLoader();
    const gltf = await loadBrainModel(loader);
    const model = gltf.scene || gltf.scenes?.[0];
    if (!model) throw new Error("The downloaded brain model did not contain a scene.");
    prepareBrainModel(THREE, model);
    root.add(model);
    brainViz.model = model;

    createBrainSignals(THREE, root);
    attachBrainPointerEvents();
    syncBrainSceneSize();
    brainViz.ready = true;
    brainViz.failed = false;
    setBrainStatus("ready", "3D brain ready");
    requestAnimationFrame(renderBrainScene);
  } catch (error) {
    console.error("3D brain failed to load", error);
    brainViz.failed = true;
    setBrainStatus("failed", "3D brain unavailable");
  } finally {
    brainViz.loading = false;
  }
}

async function loadBrainModel(loader) {
  const urls = [brainModelPath];
  if (window.location.protocol === "file:") urls.push(brainModelRemoteFallback);
  let lastError = null;
  for (const url of urls) {
    try {
      return await loader.loadAsync(url);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("Brain model could not be loaded.");
}

function addBrainLighting(THREE, scene) {
  scene.add(new THREE.HemisphereLight(0xb6fff0, 0x16090c, 1.55));

  const key = new THREE.DirectionalLight(0xffffff, 2.1);
  key.position.set(2.8, 3.4, 4.4);
  scene.add(key);

  const rim = new THREE.DirectionalLight(0x27f3cc, 1.8);
  rim.position.set(-3.2, 1.5, -3.8);
  scene.add(rim);

  const warm = new THREE.PointLight(0xff7759, 16, 7.5);
  warm.position.set(2.2, -1.4, 2.8);
  scene.add(warm);
}

function addBrainBackdrop(THREE, scene) {
  const geometry = new THREE.BufferGeometry();
  const count = 130;
  const positions = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    const radius = 1.8 + Math.random() * 2.8;
    const angle = Math.random() * Math.PI * 2;
    positions[index * 3] = Math.cos(angle) * radius;
    positions[index * 3 + 1] = (Math.random() - 0.5) * 3.3;
    positions[index * 3 + 2] = -1.8 - Math.random() * 2.5;
  }
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: 0x7ef7d4,
    size: 0.026,
    transparent: true,
    opacity: 0.2,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  brainViz.particles = new THREE.Points(geometry, material);
  scene.add(brainViz.particles);
}

function prepareBrainModel(THREE, model) {
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxAxis = Math.max(size.x, size.y, size.z, 1);
  const baseScale = 3.1 / maxAxis;

  model.scale.setScalar(baseScale);
  model.position.set(-center.x * baseScale, -center.y * baseScale, -center.z * baseScale);
  model.rotation.set(0.08, -0.28, 0.03);
  brainViz.modelBaseScale = baseScale;

  const warmTissue = new THREE.Color(0xd8a39b);
  model.traverse((node) => {
    if (!node.isMesh) return;
    const original = node.material || {};
    const originalColor = original.color?.clone?.() || warmTissue.clone();
    const material = new THREE.MeshStandardMaterial({
      color: originalColor.lerp(warmTissue, 0.62),
      map: original.map || null,
      normalMap: original.normalMap || null,
      roughness: 0.58,
      metalness: 0.03,
      transparent: true,
      opacity: 0.96,
      emissive: new THREE.Color(0x2a1416),
      emissiveIntensity: 0.2,
    });
    node.material = material;
    node.castShadow = false;
    node.receiveShadow = false;
  });
}

function createBrainSignals(THREE, root) {
  const positions = [
    { id: "visual", position: [-0.95, -0.12, 0.58], scale: 0.48 },
    { id: "visual", position: [0.94, -0.1, 0.5], scale: 0.43 },
    { id: "auditory", position: [-1.02, -0.48, 0.28], scale: 0.4 },
    { id: "language", position: [-0.58, 0.44, 0.64], scale: 0.38 },
    { id: "attention", position: [0.0, 0.72, 0.72], scale: 0.52 },
    { id: "motor", position: [0.08, 0.18, 0.86], scale: 0.42 },
    { id: "salience", position: [0.58, 0.28, 0.68], scale: 0.42 },
    { id: "default", position: [0.02, -0.62, 0.5], scale: 0.46 },
  ];
  const byId = new Map();

  for (const item of positions) {
    const channel = channels.find((entry) => entry.id === item.id);
    const sprite = createGlowSprite(THREE, channel.color);
    sprite.position.set(...item.position);
    sprite.scale.setScalar(item.scale * 0.65);
    sprite.material.opacity = 0.08;
    root.add(sprite);

    const ring = createSignalRing(THREE, channel.color, item.scale);
    ring.position.copy(sprite.position);
    root.add(ring);

    const hotspot = { ...item, channel, sprite, ring };
    brainViz.hotspots.push(hotspot);
    if (!byId.has(item.id)) byId.set(item.id, hotspot);
  }

  const pairs = [
    ["visual", "attention"],
    ["attention", "motor"],
    ["attention", "salience"],
    ["auditory", "language"],
    ["language", "salience"],
    ["default", "attention"],
  ];

  for (const [fromId, toId] of pairs) {
    const from = byId.get(fromId);
    const to = byId.get(toId);
    if (!from || !to) continue;
    const midpoint = from.sprite.position.clone().lerp(to.sprite.position, 0.5);
    midpoint.z += 0.28;
    const curve = new THREE.QuadraticBezierCurve3(from.sprite.position, midpoint, to.sprite.position);
    const geometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(34));
    const material = new THREE.LineBasicMaterial({
      color: 0x7ef7d4,
      transparent: true,
      opacity: 0.08,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const line = new THREE.Line(geometry, material);
    root.add(line);
    brainViz.signalLinks.push({ fromId, toId, line });
  }
}

function createGlowSprite(THREE, color) {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  const rgb = hexToRgb(color);
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 62);
  gradient.addColorStop(0, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 1)`);
  gradient.addColorStop(0.35, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.42)`);
  gradient.addColorStop(0.7, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.12)`);
  gradient.addColorStop(1, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0)`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    opacity: 0.08,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const sprite = new THREE.Sprite(material);
  sprite.renderOrder = 4;
  return sprite;
}

function createSignalRing(THREE, color, scale) {
  const geometry = new THREE.TorusGeometry(scale * 0.56, scale * 0.018, 8, 96);
  const material = new THREE.MeshBasicMaterial({
    color: new THREE.Color(color),
    transparent: true,
    opacity: 0.08,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const ring = new THREE.Mesh(geometry, material);
  ring.rotation.set(Math.PI / 2, 0, 0);
  ring.renderOrder = 3;
  return ring;
}

function attachBrainPointerEvents() {
  if (brainViz.pointerBound) return;
  brainViz.pointerBound = true;

  els.brainCanvas.addEventListener("pointerdown", (event) => {
    brainViz.pointer.dragging = true;
    brainViz.pointer.lastX = event.clientX;
    brainViz.pointer.lastY = event.clientY;
    brainViz.pointer.velocityX = 0;
    brainViz.pointer.velocityY = 0;
    els.brainCanvas.setPointerCapture(event.pointerId);
    els.brainStage.classList.add("is-dragging");
  });

  els.brainCanvas.addEventListener("pointermove", (event) => {
    if (!brainViz.pointer.dragging) return;
    const dx = event.clientX - brainViz.pointer.lastX;
    const dy = event.clientY - brainViz.pointer.lastY;
    brainViz.pointer.lastX = event.clientX;
    brainViz.pointer.lastY = event.clientY;
    brainViz.pointer.rotationY += dx * 0.006;
    brainViz.pointer.rotationX = clamp(brainViz.pointer.rotationX + dy * 0.004, -0.58, 0.34);
    brainViz.pointer.velocityX = dx;
    brainViz.pointer.velocityY = dy;
  });

  els.brainCanvas.addEventListener("pointerup", (event) => {
    brainViz.pointer.dragging = false;
    els.brainCanvas.releasePointerCapture(event.pointerId);
    els.brainStage.classList.remove("is-dragging");
  });

  els.brainCanvas.addEventListener("pointercancel", () => {
    brainViz.pointer.dragging = false;
    els.brainStage.classList.remove("is-dragging");
  });
}

function syncBrainSceneSize() {
  if (!brainViz.renderer || !brainViz.camera) return;
  const rect = els.brainCanvas.getBoundingClientRect();
  const width = Math.max(1, Math.floor(rect.width));
  const height = Math.max(1, Math.floor(rect.height));
  const drawingWidth = Math.floor(width * brainViz.renderer.getPixelRatio());
  const drawingHeight = Math.floor(height * brainViz.renderer.getPixelRatio());
  if (els.brainCanvas.width !== drawingWidth || els.brainCanvas.height !== drawingHeight) {
    brainViz.renderer.setSize(width, height, false);
    brainViz.camera.aspect = width / height;
    brainViz.camera.updateProjectionMatrix();
  }
}

function renderBrainScene(now) {
  requestAnimationFrame(renderBrainScene);
  if (!brainViz.renderer || !brainViz.scene || !brainViz.camera || !brainViz.root) return;

  syncBrainSceneSize();
  const delta = Math.min(0.05, Math.max(0.001, (now - brainViz.lastFrameAt) / 1000));
  const elapsed = (now - brainViz.startTime) / 1000;
  brainViz.lastFrameAt = now;

  for (const channel of channels) {
    const id = channel.id;
    brainViz.current[id] = mix(brainViz.current[id] || 0, brainViz.target[id] || 0, Math.min(1, delta * 5.6));
  }

  const activeChannels = channels.filter((channel) => channel.id !== "default");
  const intensity = average(activeChannels.map((channel) => brainViz.current[channel.id] || 0));
  if (!brainViz.pointer.dragging) {
    brainViz.pointer.rotationY += delta * (0.16 + intensity * 0.12) + brainViz.pointer.velocityX * delta * 0.003;
    brainViz.pointer.velocityX *= 0.88;
    brainViz.pointer.velocityY *= 0.88;
  }

  brainViz.root.rotation.x = brainViz.pointer.rotationX + Math.sin(elapsed * 0.7) * 0.025;
  brainViz.root.rotation.y = brainViz.pointer.rotationY;
  brainViz.root.rotation.z = Math.sin(elapsed * 0.45) * 0.025;
  brainViz.root.position.y = Math.sin(elapsed * 1.1) * 0.035;

  if (brainViz.model) {
    const pulse = 1 + intensity * 0.024 + Math.sin(elapsed * 1.6) * 0.006;
    brainViz.model.scale.setScalar(brainViz.modelBaseScale * pulse);
  }

  for (const hotspot of brainViz.hotspots) {
    const value = brainViz.current[hotspot.id] || 0;
    const wave = 0.5 + 0.5 * Math.sin(elapsed * (1.4 + value) + hotspot.position[0] * 2.4);
    const glowScale = hotspot.scale * (0.54 + value * 1.55 + wave * value * 0.12);
    hotspot.sprite.scale.setScalar(glowScale);
    hotspot.sprite.material.opacity = clamp(0.05 + value * 0.74 + wave * value * 0.08, 0.04, 0.9);
    hotspot.ring.scale.setScalar(0.78 + value * 0.78 + wave * 0.05);
    hotspot.ring.material.opacity = clamp(0.04 + value * 0.34, 0.03, 0.46);
    hotspot.ring.rotation.z += delta * (0.4 + value * 0.9);
  }

  for (const link of brainViz.signalLinks) {
    const signal = ((brainViz.current[link.fromId] || 0) + (brainViz.current[link.toId] || 0)) / 2;
    link.line.material.opacity = clamp(0.04 + signal * 0.34, 0.04, 0.4);
  }

  if (brainViz.particles) {
    brainViz.particles.rotation.y -= delta * (0.025 + intensity * 0.03);
    brainViz.particles.material.opacity = clamp(0.14 + intensity * 0.26, 0.14, 0.42);
  }

  brainViz.renderer.render(brainViz.scene, brainViz.camera);
}

function hexToRgb(hex) {
  const value = hex.replace("#", "");
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
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
  ctx.fillStyle = "#080d13";
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "rgba(237, 252, 233, 0.12)";
  ctx.lineWidth = 1;
  ctx.font = `${12 * ratio}px Inter, system-ui, sans-serif`;
  ctx.fillStyle = "rgba(245, 242, 234, 0.66)";
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
    ctx.strokeStyle = second % (tickEvery * 2) === 0 ? "rgba(237, 252, 233, 0.15)" : "rgba(237, 252, 233, 0.07)";
    ctx.beginPath();
    ctx.moveTo(x, padding.top);
    ctx.lineTo(x, padding.top + plotHeight);
    ctx.stroke();
    ctx.fillStyle = "rgba(245, 242, 234, 0.58)";
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
  ctx.strokeStyle = "#f5f2ea";
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
    resizeCanvasToDisplaySize(els.graphCanvas);
    updateCurrentValuesFromSeries();
    updateMeters(state.currentValues);
    updateBrainScene(state.currentValues);
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
initBrainScene();
draw();
