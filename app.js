const channels = [
  { id: "visual", label: "Visual", color: "#0f8b8d" },
  { id: "auditory", label: "Auditory", color: "#e4572e" },
  { id: "language", label: "Language", color: "#456990" },
  { id: "attention", label: "Attention", color: "#f2a541" },
  { id: "motor", label: "Motor", color: "#2e7d32" },
  { id: "salience", label: "Salience", color: "#b23a48" },
  { id: "default", label: "Default", color: "#7d5ba6" },
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
  sampleCanvas: document.getElementById("sampleCanvas"),
  secondRail: document.getElementById("secondRail"),
  channelMeters: document.getElementById("channelMeters"),
  analysisBadge: document.getElementById("analysisBadge"),
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
  lastAnalysisAt: 0,
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
        </span>
        <span class="meter-value">0.00</span>
      </div>
      <div class="meter-track">
        <span class="meter-fill" style="background:${channel.color}"></span>
      </div>
    `;
    els.channelMeters.appendChild(meter);
  }
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
  els.dropZone.classList.remove("is-portrait");
  els.video.src = state.videoUrl;
  els.video.load();
  resetAnalysis(0);
  els.emptyState.classList.add("is-hidden");
  els.videoName.textContent = file.name;
  els.modeBadge.textContent = "Demo signal";
  els.modeBadge.style.color = "#0d585a";
  els.modeBadge.style.background = "rgba(15, 139, 141, 0.12)";
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

function renderAnalysis(force = false) {
  const now = performance.now();
  if (!force && now - state.lastAnalysisAt < 650) return;
  state.lastAnalysisAt = now;

  const rows = getObservedRows();
  if (rows.length === 0) {
    els.analysisBadge.textContent = "Waiting for playback";
    els.engagementScore.textContent = "--";
    els.engagementVerdict.textContent = "Play the video";
    els.engagementSummary.textContent =
      "Upload and play a video to generate timestamp-level engagement notes.";
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
  els.analysisBadge.textContent = observedLabel;
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
  if (score >= 0.74) return { label: "Strong audience pull", tone: "strong" };
  if (score >= 0.58) return { label: "Promising with edits", tone: "promising" };
  if (score >= 0.42) return { label: "Needs a sharper hook", tone: "soft" };
  return { label: "Low retention risk", tone: "low" };
}

function buildEngagementSummary(rows, score, verdict) {
  const firstThree = rows.filter((row) => row.second < 3);
  const firstScore = firstThree.length ? average(firstThree.map((row) => row.engagement)) : score;
  const peak = maxBy(rows, (row) => row.engagement);
  const audio = average(rows.map((row) => row.audioSignal));
  const motion = average(rows.map((row) => row.motionSignal));
  const opening = firstScore >= 0.58 ? "The opening is carrying enough signal to earn a first watch." : "The opening could work harder in the first 2-3 seconds.";
  const driver = motion > audio ? "Movement and visual change are the main engagement drivers." : "Audio, voice, or rhythm appears to be doing more of the work.";
  return `${verdict.label}. ${opening} ${driver} The strongest observed moment is around ${formatTimestamp(peak.second)}, where ${peak.dominant.label.toLowerCase()} and attention signals are highest.`;
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
      title: "Peak hook: motion and salience align",
      body: "A faster visual beat is likely to hold attention here. This is a good place for the core product or payoff.",
    };
  }
  if (audioSignal >= 0.5 && values.language >= 0.36) {
    return {
      key: "audio-message",
      title: "Audio-led message beat",
      body: "The signal is being carried by sound, speech, or rhythm. Captions and clear offer text would reinforce this moment.",
    };
  }
  if (values.attention >= 0.52 && values.visual >= 0.38) {
    return {
      key: "visual-lift",
      title: "Visual attention lift",
      body: "The frame has enough change and contrast to pull focus. Keep the viewer oriented with a clear subject or benefit.",
    };
  }
  if (values.salience >= 0.42) {
    return {
      key: "salience-spike",
      title: "Salience spike",
      body: "This reads as a noticeable beat. It can support a reveal, price cue, before-after moment, or call to action.",
    };
  }
  if (values.default >= 0.58 && engagement < 0.48) {
    return {
      key: "low-change",
      title: "Low-change stretch",
      body: "The signal relaxes here. Trim, add a pattern interrupt, or place copy that explains why the viewer should stay.",
    };
  }
  return {
    key: "steady",
    title: "Steady engagement beat",
    body: `The ${row.dominant.label.toLowerCase()} signal leads here, with moderate retention potential.`,
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
    items.push("Move the strongest visual or audio payoff into the first 2 seconds.");
  }
  if (motion < 0.28 && attention < 0.5) {
    items.push("Add a clear pattern interrupt: tighter cut, camera move, product reveal, or before-after shift.");
  }
  if (audio < 0.32) {
    items.push("Use a stronger beat, voiceover, or caption-led hook so silent and sound-on viewers both understand the promise.");
  }
  if (defaultMode > 0.55 || salience < 0.32) {
    items.push("Trim low-change stretches and put the offer, transformation, or tension closer to the attention peaks.");
  }
  if (score >= 0.68) {
    items.push("Keep the current pacing, then test two hook variants rather than rebuilding the whole creative.");
  }
  if (items.length === 0) {
    items.push("Strengthen the hook, keep the clearest proof point, and test a more direct call to action.");
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
    fits.push("Awareness or top-of-funnel creative where fast visual proof matters.");
  }
  if (audio > 0.38 || language > 0.34) {
    fits.push("Creator testimonial, explainer, or offer-led campaign with captions.");
  }
  if (salience > 0.38) {
    fits.push("Launch, drop, limited-time offer, or before-after story.");
  }
  if (score < 0.5) {
    fits.push("Retargeting only after tightening the hook and cutting low-signal seconds.");
  } else {
    fits.push("A/B test as paid social with separate hook, CTA, and caption variants.");
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

  const background = ctx.createLinearGradient(0, 0, width, height);
  background.addColorStop(0, "#fbfcfb");
  background.addColorStop(1, "#edf2f0");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);

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
  ctx.globalAlpha = 0.42;
  ctx.strokeStyle = "#384047";
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
  gradient.addColorStop(0, "#dfe6e2");
  gradient.addColorStop(0.48, "#f7f8f7");
  gradient.addColorStop(1, "#cbd5d1");
  ctx.fillStyle = gradient;
  ctx.shadowColor = "rgba(23, 25, 28, 0.16)";
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 10;
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.strokeStyle = "#96a19e";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

function drawMidline(ctx, width, height) {
  ctx.save();
  ctx.strokeStyle = "#c2cbc7";
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
  ctx.globalCompositeOperation = "multiply";
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, colorWithAlpha(color, 0.72 * value));
  gradient.addColorStop(0.42, colorWithAlpha(color, 0.32 * value));
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
  const padding = { left: 54, right: 22, top: 24, bottom: 42 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const series = activeSeries();
  const seconds = Math.max(1, state.seconds);
  const current = els.video.currentTime || 0;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#fbfcfb";
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "#dfe6e2";
  ctx.lineWidth = 1;
  ctx.font = "24px Inter, system-ui, sans-serif";
  ctx.fillStyle = "#6d767f";
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

  const tickEvery = seconds <= 20 ? 1 : seconds <= 80 ? 5 : 10;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (let second = 0; second <= seconds; second += tickEvery) {
    const x = padding.left + (second / seconds) * plotWidth;
    ctx.strokeStyle = second % (tickEvery * 2) === 0 ? "#cbd5d1" : "#e9eeeb";
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
    ctx.lineWidth = 4;
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
  ctx.strokeStyle = "#17191c";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cursorX, padding.top - 4);
  ctx.lineTo(cursorX, padding.top + plotHeight + 4);
  ctx.stroke();
  ctx.restore();

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = "22px Inter, system-ui, sans-serif";
  let legendX = padding.left;
  const legendY = height - 12;
  for (const channel of channels) {
    ctx.fillStyle = channel.color;
    ctx.fillRect(legendX, legendY - 15, 16, 8);
    ctx.fillStyle = "#30363c";
    ctx.fillText(channel.label, legendX + 24, legendY - 5);
    legendX += ctx.measureText(channel.label).width + 66;
  }
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
  resizeCanvasToDisplaySize(els.brainCanvas);
  resizeCanvasToDisplaySize(els.graphCanvas);

  if (!els.video.paused) {
    const now = performance.now();
    if (now - state.lastFrameAt > 85) {
      state.lastFrameAt = now;
      absorbLiveValues(safelySampleVideoFeatures());
    }
  }

  updateCurrentValuesFromSeries();
  updateMeters(state.currentValues);
  drawBrain(state.currentValues);
  drawGraph();
  updateStatus();
  updateSecondRail();
  renderAnalysis();
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
    } else {
      els.video.pause();
    }
  } catch (error) {
    console.error("Video playback failed", error);
    els.modeBadge.textContent = "Playback error";
    els.modeBadge.style.color = "#8d1f1f";
    els.modeBadge.style.background = "rgba(178, 58, 72, 0.16)";
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
  setupAudioAnalyser();
});

els.video.addEventListener("pause", () => {
  els.playButton.textContent = "Play";
});

els.video.addEventListener("ended", () => {
  els.playButton.textContent = "Play";
});

els.video.addEventListener("error", () => {
  console.error("Video element error", els.video.error);
  els.modeBadge.textContent = "Video error";
  els.modeBadge.style.color = "#8d1f1f";
  els.modeBadge.style.background = "rgba(178, 58, 72, 0.16)";
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

window.addEventListener("resize", () => {
  drawBrain(state.currentValues);
  drawGraph();
});

initMeters();
resetAnalysis(0);
draw();
