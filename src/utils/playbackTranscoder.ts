import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

export type PlaybackTranscodeProgress = {
  phase: "loading" | "reading" | "converting" | "finalizing";
  percent: number;
  message: string;
};

let ffmpeg: FFmpeg | null = null;
let loadPromise: Promise<FFmpeg> | null = null;

const report = (
  onProgress: ((progress: PlaybackTranscodeProgress) => void) | undefined,
  progress: PlaybackTranscodeProgress
) => {
  onProgress?.(progress);
};

const getFFmpeg = async (
  onProgress?: (progress: PlaybackTranscodeProgress) => void
) => {
  if (ffmpeg) return ffmpeg;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    report(onProgress, {
      phase: "loading",
      percent: 0,
      message: "Preparando conversor de video",
    });

    const instance = new FFmpeg();
    instance.on("log", ({ message }: { message: string }) => {
      console.log(`[playback-transcode] ${message}`);
    });

    await instance.load({
      coreURL: await toBlobURL("/ffmpeg/ffmpeg-core.js", "text/javascript"),
      wasmURL: await toBlobURL("/ffmpeg/ffmpeg-core.wasm", "application/wasm"),
    });

    ffmpeg = instance;
    return instance;
  })();

  return loadPromise;
};

export const transcodeToPlayableMp4 = async (
  input: File | Blob | Uint8Array,
  onProgress?: (progress: PlaybackTranscodeProgress) => void
) => {
  const instance = await getFFmpeg(onProgress);
  const runId = Date.now().toString(36);
  const inputName = `playback_input_${runId}.mp4`;
  const outputName = `playback_output_${runId}.mp4`;

  const handleProgress = ({ progress }: { progress: number }) => {
    report(onProgress, {
      phase: "converting",
      percent: Math.max(1, Math.min(99, Math.round(progress * 100))),
      message: "Convirtiendo a formato compatible",
    });
  };

  instance.on("progress", handleProgress);

  try {
    report(onProgress, {
      phase: "reading",
      percent: 0,
      message: "Leyendo archivo original",
    });

    const inputBlob = input instanceof Uint8Array ? new Blob([input]) : input;
    await instance.writeFile(inputName, await fetchFile(inputBlob));

    report(onProgress, {
      phase: "converting",
      percent: 1,
      message: "Convirtiendo a H.264 + AAC",
    });

    await instance.exec([
      "-i",
      inputName,
      "-map",
      "0:v:0",
      "-map",
      "0:a?",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-crf",
      "23",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-ar",
      "44100",
      "-movflags",
      "+faststart",
      outputName,
    ]);

    report(onProgress, {
      phase: "finalizing",
      percent: 99,
      message: "Preparando video convertido",
    });

    const data = await instance.readFile(outputName);
    const blob = new Blob([data], { type: "video/mp4" });
    const file = new File([blob], "Flowuana-compatible.mp4", {
      type: "video/mp4",
    });
    const url = URL.createObjectURL(blob);

    report(onProgress, {
      phase: "finalizing",
      percent: 100,
      message: "Video compatible listo",
    });

    return { file, url };
  } finally {
    try {
      await instance.deleteFile(inputName);
    } catch {}
    try {
      await instance.deleteFile(outputName);
    } catch {}
  }
};
