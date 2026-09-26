import { Clip, ColorCorrection, Resolution } from "@/hooks/useTimeline";
import { getClipDuration, sortClipsByTimeline } from "@/utils/timeline";

// Export runs on the native ffmpeg.exe bundled next to the app (see src-tauri/src/render.rs):
// it reads the source straight from disk and writes the result straight into
// Videos\Exportaciones de Flowuana, so there is no size limit and nothing stays in memory.

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const FPS = 30;
const AUDIO_RATE = 48000;
const UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;

export type ExportFormat = "mp4" | "mp3" | "mp4-muted";

const buildColorFilterChain = (colorCorrection?: ColorCorrection) => {
  if (!colorCorrection?.enabled) return "";

  const brightness = clamp(colorCorrection.brightness / 100, -0.5, 0.5);
  const contrast = clamp(1 + colorCorrection.contrast / 100, 0.5, 1.5);
  const saturation = clamp(1 + colorCorrection.saturation / 100, 0.5, 1.5);
  const shadowGamma = clamp(1 + colorCorrection.shadows / 120, 0.6, 1.45);
  const highlights = clamp(colorCorrection.highlights / 50, -1, 1);
  const highlightPoint = clamp(0.85 + highlights * 0.13, 0.68, 0.98);
  const temperature = clamp(colorCorrection.temperature / 300, -0.18, 0.18);
  const redGain = clamp(1 + temperature, 0.82, 1.18);
  const blueGain = clamp(1 - temperature, 0.82, 1.18);

  const filters = [
    `eq=brightness=${brightness.toFixed(3)}:contrast=${contrast.toFixed(3)}:saturation=${saturation.toFixed(3)}:gamma=${shadowGamma.toFixed(3)}`,
  ];

  if (Math.abs(colorCorrection.highlights) > 0.01) {
    filters.push(`curves=all='0/0 0.55/0.55 0.85/${highlightPoint.toFixed(3)} 1/1'`);
  }

  filters.push(`colorchannelmixer=rr=${redGain.toFixed(3)}:gg=1.000:bb=${blueGain.toFixed(3)}`);
  return filters.join(",");
};

/** Where the zoomed/moved source sits inside the export frame (same math as the preview). */
const computePlacement = (
  zoom: number,
  posX: number,
  posY: number,
  sourceWidth: number,
  sourceHeight: number,
  resolution: Resolution
) => {
  const targetW = resolution.w;
  const targetH = resolution.h;

  const isPortraitToLandscape = sourceHeight > sourceWidth && targetW > targetH;
  const isLandscapeToPortrait = sourceWidth > sourceHeight && targetH > targetW;
  const formatRequiresFill = isPortraitToLandscape || isLandscapeToPortrait;

  const maxScale = Math.max(targetW / sourceWidth, targetH / sourceHeight);
  const baseAspectScale = targetW / targetH;
  const sourceAspectScale = sourceWidth / sourceHeight;
  const aspectAdjustment = formatRequiresFill
    ? Math.max(baseAspectScale / sourceAspectScale, sourceAspectScale / baseAspectScale)
    : 1;

  const exportScale = (zoom / 100) * aspectAdjustment;
  const scaledW = Math.max(2, Math.round(sourceWidth * maxScale * exportScale));
  const scaledH = Math.max(2, Math.round(sourceHeight * maxScale * exportScale));

  const translateXPercent = ((posX - 50) * -1) / 100;
  const translateYPercent = ((posY - 50) * -1) / 100;
  let x = Math.round((targetW - scaledW) / 2 + targetW * translateXPercent);
  let y = Math.round((targetH - scaledH) / 2 + targetH * translateYPercent);
  if (scaledW % 2 !== 0) x += 1;
  if (scaledH % 2 !== 0) y += 1;

  return { targetW, targetH, scaledW, scaledH, x, y };
};

export interface RenderJob {
  inputPath: string;
  inputs: { start: number; duration: number }[];
  filter: string;
  maps: string[];
  format: ExportFormat;
  totalDuration: number;
  fileName: string;
}

/**
 * One ffmpeg run for the whole timeline: every clip is its own input (seeked with -ss/-t,
 * so only that range is decoded), gaps become black frames + silence, and everything is
 * joined with the concat filter. Single encode, no intermediate files.
 */
export const buildRenderJob = (opts: {
  inputPath: string;
  hasAudio: boolean;
  clips: Clip[];
  zoom: number;
  posX: number;
  posY: number;
  format: ExportFormat;
  sourceWidth: number;
  sourceHeight: number;
  resolution: Resolution;
  colorCorrection?: ColorCorrection;
  fileName: string;
}): RenderJob => {
  const { format, hasAudio } = opts;
  const withVideo = format !== "mp3";
  const withAudio = format !== "mp4-muted";
  const { targetW, targetH, scaledW, scaledH, x, y } = computePlacement(
    opts.zoom, opts.posX, opts.posY, opts.sourceWidth, opts.sourceHeight, opts.resolution
  );
  const color = buildColorFilterChain(opts.colorCorrection);
  const blackFrame = (duration: number) =>
    `color=c=black:s=${targetW}x${targetH}:r=${FPS}:d=${duration.toFixed(3)}`;
  const silence = (duration: number) =>
    `anullsrc=r=${AUDIO_RATE}:cl=stereo,atrim=end=${duration.toFixed(3)}`;

  const inputs: RenderJob["inputs"] = [];
  const graph: string[] = [];
  const parts: string[] = [];
  let cursor = 0;

  const addPart = (videoChain: () => string, audioChain: () => string) => {
    const n = parts.length;
    let labels = "";
    if (withVideo) {
      graph.push(`${videoChain()},format=yuv420p,setsar=1[v${n}]`);
      labels += `[v${n}]`;
    }
    if (withAudio) {
      graph.push(`${audioChain()}[a${n}]`);
      labels += `[a${n}]`;
    }
    parts.push(labels);
  };

  for (const clip of sortClipsByTimeline(opts.clips)) {
    const duration = getClipDuration(clip);
    if (duration <= 0) continue;

    const gap = clip.startAt - cursor;
    if (gap > 0.01) addPart(() => blackFrame(gap), () => silence(gap));

    const i = inputs.length;
    inputs.push({ start: clip.trimStart, duration });
    addPart(
      () => {
        const scaled = [`scale=${scaledW}:${scaledH}`, color, `fps=${FPS}`, "setpts=PTS-STARTPTS"]
          .filter(Boolean)
          .join(",");
        graph.push(`[${i}:v]${scaled}[s${i}]`, `${blackFrame(duration)}[b${i}]`);
        return `[b${i}][s${i}]overlay=${x}:${y}`;
      },
      () =>
        hasAudio
          ? `[${i}:a]aresample=${AUDIO_RATE},aformat=sample_fmts=fltp:channel_layouts=stereo,apad,atrim=end=${duration.toFixed(3)},asetpts=PTS-STARTPTS`
          : silence(duration)
    );
    cursor = clip.startAt + duration;
  }

  if (inputs.length === 0) throw new Error("No hay clips para exportar.");

  const outputs = `${withVideo ? "[outv]" : ""}${withAudio ? "[outa]" : ""}`;
  graph.push(`${parts.join("")}concat=n=${parts.length}:v=${withVideo ? 1 : 0}:a=${withAudio ? 1 : 0}${outputs}`);

  return {
    inputPath: opts.inputPath,
    inputs,
    filter: graph.join(";"),
    maps: [withVideo && "[outv]", withAudio && "[outa]"].filter(Boolean) as string[],
    format,
    totalDuration: cursor,
    fileName: opts.fileName,
  };
};

export const probeHasAudio = async (path: string) => {
  const { invoke } = await import("@tauri-apps/api/tauri");
  return invoke<boolean>("probe_has_audio", { path });
};

/**
 * Videos opened from the file picker only exist as a File (no disk path), so they are
 * streamed to a temp file that the caller must delete with `deleteTempCopy`.
 */
export const copyFileToTemp = async (file: File, onProgress: (ratio: number) => void) => {
  const { invoke } = await import("@tauri-apps/api/tauri");
  const extension = file.name.split(".").pop() || "mp4";
  const path = await invoke<string>("temp_create", { extension });
  try {
    for (let offset = 0; offset < file.size; offset += UPLOAD_CHUNK_BYTES) {
      const chunk = file.slice(offset, offset + UPLOAD_CHUNK_BYTES);
      const base64Chunk = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(chunk);
      });
      await invoke("temp_append", { path, base64Chunk });
      onProgress(Math.min(1, (offset + chunk.size) / file.size));
    }
  } catch (e) {
    await deleteTempCopy(path);
    throw e;
  }
  return path;
};

export const deleteTempCopy = async (path: string) => {
  const { invoke } = await import("@tauri-apps/api/tauri");
  await invoke("temp_delete", { path }).catch(() => {});
};

/** Runs the job; resolves with the saved file path. Rejects with "CANCELADO" on cancel. */
export const runRender = async (job: RenderJob, onProgress: (ratio: number) => void) => {
  const { invoke } = await import("@tauri-apps/api/tauri");
  const { listen } = await import("@tauri-apps/api/event");
  const unlisten = await listen<{ ratio: number }>("render-progress", (event) =>
    onProgress(clamp(event.payload.ratio, 0, 1))
  );
  try {
    return await invoke<string>("render_video", { job });
  } finally {
    unlisten();
  }
};

export const cancelRender = async () => {
  const { invoke } = await import("@tauri-apps/api/tauri");
  await invoke("cancel_render");
};

export const revealInFolder = async (path: string) => {
  const { invoke } = await import("@tauri-apps/api/tauri");
  await invoke("reveal_in_folder", { path });
};
