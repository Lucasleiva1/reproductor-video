import type { ColorCorrection } from "@/hooks/useTimeline";

export type AnalysisProgress = {
  current: number;
  total: number;
  phase: "preparing" | "sampling" | "computing";
  message: string;
};

type AnalyzeVideoOptions = {
  videoUrl: string;
  duration: number;
  samples?: number;
  onProgress?: (progress: AnalysisProgress) => void;
  shouldAbort?: () => boolean;
};

type FrameMetrics = {
  luma: number;
  saturation: number;
  warmth: number;
  low: number;
  high: number;
  peak: number;
  blackClip: number;
  whiteClip: number;
  dynamicRange: number;
};

export type SuggestedCorrection = Pick<
  ColorCorrection,
  "brightness" | "highlights" | "shadows" | "contrast" | "saturation" | "temperature"
>;

export type VideoImageAnalysis = {
  sampledFrames: number;
  representativeFrames: number;
  shadowsPercent: number;
  highlightsPercent: number;
  averageLight: number;
  dynamicRange: number;
  averageSaturation: number;
  suggestedCorrection: SuggestedCorrection;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const waitForMetadata = (video: HTMLVideoElement) =>
  new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error("No se pudo cargar el video para analizar."));
  });

const seekTo = (video: HTMLVideoElement, time: number) =>
  new Promise<void>((resolve, reject) => {
    video.onseeked = () => resolve();
    video.onerror = () => reject(new Error("No se pudo leer un frame del video."));
    video.currentTime = time;
  });

const waitForPaint = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });

const average = (frames: FrameMetrics[], field: keyof FrameMetrics) =>
  frames.reduce((total, frame) => total + frame[field], 0) / Math.max(1, frames.length);

const percentile = (histogram: number[], pixelCount: number, target: number) => {
  const threshold = pixelCount * target;
  let seen = 0;
  for (let i = 0; i < histogram.length; i++) {
    seen += histogram[i];
    if (seen >= threshold) return i / 100;
  }
  return 1;
};

const measureFrame = (data: Uint8ClampedArray): FrameMetrics => {
  let lumaSum = 0;
  let saturationSum = 0;
  let warmSum = 0;
  let warmCount = 0;
  let blackCount = 0;
  let whiteCount = 0;
  let pixelCount = 0;
  const histogram = new Array<number>(101).fill(0);

  // Every second pixel is enough for stable statistics while keeping long scans responsive.
  for (let i = 0; i < data.length; i += 8) {
    const r = data[i] / 255;
    const g = data[i + 1] / 255;
    const b = data[i + 2] / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const saturation = max === 0 ? 0 : (max - min) / max;

    lumaSum += luma;
    saturationSum += saturation;
    histogram[Math.round(clamp(luma * 100, 0, 100))] += 1;
    if (luma < 0.035) blackCount += 1;
    if (luma > 0.965) whiteCount += 1;
    pixelCount += 1;

    if (luma > 0.18 && luma < 0.84 && saturation < 0.48) {
      warmSum += r - b;
      warmCount += 1;
    }
  }

  const low = percentile(histogram, pixelCount, 0.08);
  const high = percentile(histogram, pixelCount, 0.92);

  return {
    luma: lumaSum / Math.max(1, pixelCount),
    saturation: saturationSum / Math.max(1, pixelCount),
    warmth: warmSum / Math.max(1, warmCount),
    low,
    high,
    peak: percentile(histogram, pixelCount, 0.985),
    blackClip: blackCount / Math.max(1, pixelCount),
    whiteClip: whiteCount / Math.max(1, pixelCount),
    dynamicRange: high - low,
  };
};

const selectRepresentativeFrames = (frames: FrameMetrics[]) => {
  const usable = frames.filter(
    (frame) => frame.luma > 0.045 && frame.luma < 0.96 && frame.dynamicRange > 0.045,
  );
  const candidates = usable.length >= Math.max(8, Math.round(frames.length * 0.35)) ? usable : frames;
  const sorted = [...candidates].sort((a, b) => a.luma - b.luma);
  const trim = sorted.length >= 12 ? Math.floor(sorted.length * 0.1) : 0;
  return sorted.slice(trim, sorted.length - trim || sorted.length);
};

export async function analyzeVideoImage({
  videoUrl,
  duration,
  samples = 144,
  onProgress,
  shouldAbort,
}: AnalyzeVideoOptions): Promise<VideoImageAnalysis> {
  const video = document.createElement("video");
  video.src = videoUrl;
  video.crossOrigin = "anonymous";
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas context no disponible.");

  try {
    onProgress?.({ current: 0, total: 1, phase: "preparing", message: "Preparando lectura del video" });
    await waitForMetadata(video);

    const safeDuration = Math.max(0.1, Math.min(duration || video.duration || 0, video.duration || duration || 0));
    const requestedSamples = Math.max(1, samples);
    const totalSamples = Math.max(36, Math.min(requestedSamples, Math.ceil(safeDuration * 3)));
    const width = 160;
    const aspect = video.videoHeight > 0 && video.videoWidth > 0 ? video.videoHeight / video.videoWidth : 9 / 16;
    canvas.width = width;
    canvas.height = Math.max(90, Math.round(width * aspect));

    const frames: FrameMetrics[] = [];
    onProgress?.({ current: 0, total: totalSamples, phase: "sampling", message: "Analizando escenas del video" });

    for (let sampleIndex = 0; sampleIndex < totalSamples; sampleIndex++) {
      if (shouldAbort?.()) throw new Error("Analisis cancelado.");
      const ratio = (sampleIndex + 0.5) / totalSamples;
      const time = clamp(ratio * safeDuration, 0, Math.max(0, safeDuration - 0.05));
      await seekTo(video, time);

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      frames.push(measureFrame(ctx.getImageData(0, 0, canvas.width, canvas.height).data));

      onProgress?.({
        current: sampleIndex + 1,
        total: totalSamples,
        phase: "sampling",
        message: "Analizando escenas del video",
      });
      await waitForPaint();
    }

    onProgress?.({
      current: totalSamples,
      total: totalSamples,
      phase: "computing",
      message: "Calculando ajuste de color",
    });
    await waitForPaint();

    const representativeFrames = selectRepresentativeFrames(frames);
    const avgLuma = average(representativeFrames, "luma");
    const avgSaturation = average(representativeFrames, "saturation");
    const avgWarmth = average(representativeFrames, "warmth");
    const avgLow = average(representativeFrames, "low");
    const avgHigh = average(representativeFrames, "high");
    const avgPeak = average(representativeFrames, "peak");
    const blackClip = average(representativeFrames, "blackClip");
    const whiteClip = average(representativeFrames, "whiteClip");
    const dynamicRange = average(representativeFrames, "dynamicRange");

    const brightness = clamp((0.46 - avgLuma) * 62, -20, 20);
    const shadows = clamp((0.16 - avgLow) * 105 + blackClip * 70, -18, 30);
    const highlightCompression = Math.max(0, avgPeak - 0.92) * 220 + whiteClip * 85;
    const highlightLift = Math.max(0, 0.86 - avgHigh) * 48;
    const highlights = clamp(highlightCompression > 1 ? -highlightCompression : highlightLift, -28, 18);
    const contrast = clamp((0.56 - dynamicRange) * 56, -16, 22);
    const saturation = clamp((0.33 - avgSaturation) * 48, -12, 18);
    const temperature = clamp(-avgWarmth * 82, -16, 16);

    return {
      sampledFrames: frames.length,
      representativeFrames: representativeFrames.length,
      shadowsPercent: Math.round(blackClip * 100),
      highlightsPercent: Math.round(whiteClip * 100),
      averageLight: Math.round(avgLuma * 100),
      dynamicRange: Math.round(dynamicRange * 100),
      averageSaturation: Math.round(avgSaturation * 100),
      suggestedCorrection: {
        brightness: Math.round(brightness),
        highlights: Math.round(highlights),
        shadows: Math.round(shadows),
        contrast: Math.round(contrast),
        saturation: Math.round(saturation),
        temperature: Math.round(temperature),
      },
    };
  } finally {
    video.onloadedmetadata = null;
    video.onseeked = null;
    video.onerror = null;
    video.removeAttribute("src");
    video.load();
  }
}
