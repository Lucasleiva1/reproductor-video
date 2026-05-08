import { useState, useRef, useEffect } from "react";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
import { Clip, ColorCorrection, Resolution } from "@/hooks/useTimeline";
import { getClipDuration, sortClipsByTimeline } from "@/utils/timeline";

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const buildColorFilterChain = (colorCorrection?: ColorCorrection) => {
  if (!colorCorrection?.enabled) return "";

  const brightness = clamp(colorCorrection.brightness / 100, -0.5, 0.5);
  const contrast = clamp(1 + colorCorrection.contrast / 100, 0.5, 1.5);
  const saturation = clamp(1 + colorCorrection.saturation / 100, 0.5, 1.5);
  const shadowGamma = clamp(1 + colorCorrection.shadows / 120, 0.6, 1.45);
  const temperature = clamp(colorCorrection.temperature / 300, -0.18, 0.18);
  const redGain = clamp(1 + temperature, 0.82, 1.18);
  const blueGain = clamp(1 - temperature, 0.82, 1.18);

  return [
    `eq=brightness=${brightness.toFixed(3)}:contrast=${contrast.toFixed(3)}:saturation=${saturation.toFixed(3)}:gamma=${shadowGamma.toFixed(3)}`,
    `colorchannelmixer=rr=${redGain.toFixed(3)}:gg=1.000:bb=${blueGain.toFixed(3)}`,
  ].join(",");
};

export function useFFmpeg() {
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const ffmpegRef = useRef<any>(null);
  const messageRef = useRef<string>("");

  useEffect(() => {
    ffmpegRef.current = new FFmpeg();
    load();
  }, []);

  const load = async () => {
    setLoading(true);
    const baseURL = "/ffmpeg";
    const ffmpeg = ffmpegRef.current;
    
    ffmpeg.on("log", ({ message }: any) => {
      messageRef.current = message;
      console.log(message);
    });
    
    ffmpeg.on("progress", ({ progress }: any) => {
      setProgress(Math.round(progress * 100));
    });

    try {
      await ffmpeg.load({
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
      });
      setLoaded(true);
    } catch (e) {
      console.error("FFmpeg load failed", e);
    } finally {
      setLoading(false);
    }
  };

  const renderVideo = async (
    videoFileOrData: File | Uint8Array,
    clips: Clip[], // Replaced startTime/endTime with clips array
    zoom: number,
    posX: number,
    posY: number,
    format: "mp4" | "mp3" | "mp4-muted",
    sourceWidth: number,
    sourceHeight: number,
    resolution: Resolution,
    colorCorrection?: ColorCorrection
  ) => {
    if (!ffmpegRef.current) throw new Error("FFmpeg not loaded");
    const ffmpeg = ffmpegRef.current;

    const inputName = "input.mp4";
    const finalOutputName = `output.${format.startsWith("mp4") ? "mp4" : "mp3"}`;

    await ffmpeg.writeFile(inputName, await fetchFile(videoFileOrData instanceof Uint8Array ? new Blob([videoFileOrData as any]) : videoFileOrData));

    const targetW = resolution.w;
    const targetH = resolution.h;

    // We calculate scaling just like before for the preview container
    const isPortraitToLandscape = sourceHeight > sourceWidth && targetW > targetH;
    const isLandscapeToPortrait = sourceWidth > sourceHeight && targetH > targetW;
    const formatRequiresFill = isPortraitToLandscape || isLandscapeToPortrait;

    const scaleBaseW = formatRequiresFill ? targetW / sourceWidth : targetW / sourceWidth;
    const scaleBaseH = formatRequiresFill ? targetH / sourceHeight : targetH / sourceHeight;
    const maxScale = Math.max(scaleBaseW, scaleBaseH);

    const baseAspectScale = targetW / targetH;
    const sourceAspectScale = sourceWidth / sourceHeight;
    const aspectAdjustment = formatRequiresFill 
      ? Math.max(baseAspectScale / sourceAspectScale, sourceAspectScale / baseAspectScale) 
      : 1;

    const exportScale = (zoom / 100) * aspectAdjustment;
    const scaledInternalW = Math.round(sourceWidth * maxScale * exportScale);
    const scaledInternalH = Math.round(sourceHeight * maxScale * exportScale);
    const colorFilterChain = buildColorFilterChain(colorCorrection);
    const scaledVideoFilter = colorFilterChain
      ? `scale=${scaledInternalW}:${scaledInternalH},${colorFilterChain}[scaled]`
      : `scale=${scaledInternalW}:${scaledInternalH}[scaled]`;

    const translateXPercent = ((posX - 50) * -1) / 100;
    const translateYPercent = ((posY - 50) * -1) / 100;
    
    let videoX = Math.round((targetW - scaledInternalW) / 2 + (targetW * translateXPercent));
    let videoY = Math.round((targetH - scaledInternalH) / 2 + (targetH * translateYPercent));

    if (scaledInternalW % 2 !== 0) videoX += 1;
    if (scaledInternalH % 2 !== 0) videoY += 1;

    // Process each timeline clip individually. The timeline is the source of truth:
    // each segment uses the original media only between trimStart and trimEnd.
    const segmentNames: string[] = [];
    let currentTimelineTime = 0;

    // Order clips by global timeline start time (startAt)
    const sortedClips = sortClipsByTimeline(clips);

    for (let i = 0; i < sortedClips.length; i++) {
        const clip = sortedClips[i];
        
        // Check for gap BEFORE this clip
        if (clip.startAt > currentTimelineTime) {
            const gapDuration = clip.startAt - currentTimelineTime;
            const gapName = `gap_${i}.${format === "mp3" ? "mp3" : "mp4"}`;
            segmentNames.push(gapName);
            
            console.log(`Generating empty gap segment: ${gapDuration}s`);
            if (format === "mp3") {
              await ffmpeg.exec([
                "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
                "-t", gapDuration.toString(),
                "-acodec", "libmp3lame",
                "-q:a", "2",
                gapName
              ]);
            } else {
              const gapArgs =
                format === "mp4-muted"
                  ? [
                      "-f", "lavfi", "-i", `color=c=black:s=${targetW}x${targetH}:r=30`,
                      "-t", gapDuration.toString(),
                      "-c:v", "libx264", "-preset", "ultrafast",
                      "-pix_fmt", "yuv420p",
                    ]
                  : [
                      "-f", "lavfi", "-i", `color=c=black:s=${targetW}x${targetH}:r=30`,
                      "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
                      "-t", gapDuration.toString(),
                      "-c:v", "libx264", "-preset", "ultrafast",
                      "-pix_fmt", "yuv420p",
                  "-shortest",
                  "-c:a", "aac",
                  "-b:a", "128k",
                  "-ar", "44100"
                    ];
              gapArgs.push(gapName);
              await ffmpeg.exec(gapArgs);
            }
        }

        const clipDuration = getClipDuration(clip);
        if (clipDuration <= 0) continue;

        const segmentName = `segment_${i}.${format === "mp3" ? "mp3" : "mp4"}`;
        segmentNames.push(segmentName);

        const args = [
            "-ss", clip.trimStart.toString(),
            "-i", inputName,
            "-t", clipDuration.toString(),
        ];

        if (format === "mp3") {
            args.push(
                "-vn",
                "-acodec", "libmp3lame",
                "-q:a", "2"
            );
        } else {
            args.push(
                "-c:v", "libx264",
                "-preset", "ultrafast",
                "-filter_complex", `color=c=black:s=${targetW}x${targetH}:r=30[bg];[0:v]${scaledVideoFilter};[bg][scaled]overlay=${videoX}:${videoY}:shortest=1,format=yuv420p[out]`,
                "-map", "[out]",
                "-map", "0:a?"
            );
            if (format === "mp4-muted") {
                args.push("-an");
            } else {
                args.push("-c:a", "aac", "-b:a", "128k", "-ar", "44100");
            }
        }
        
        args.push(segmentName);
        console.log(`Rendering segment ${i}`, args);
        await ffmpeg.exec(args);

        currentTimelineTime = clip.startAt + clipDuration;
    }

    if (segmentNames.length === 0) throw new Error("No clips to export");

    if (format === "mp3") {
        // If it's just audio, concat the mp3 files
        const concatTxtName = "concat.txt";
        const concatText = segmentNames.map(f => `file '${f}'`).join("\n");
        await ffmpeg.writeFile(concatTxtName, concatText);
        
        await ffmpeg.exec([
            "-f", "concat",
            "-safe", "0",
            "-i", concatTxtName,
            "-vn",
            "-acodec", "libmp3lame",
            "-q:a", "2",
            finalOutputName
        ]);
    } else {
        // Concat and normalize timestamps/codecs in the final file. This avoids
        // accelerated-looking playback or stray tails caused by segment metadata.
        const concatTxtName = "concat.txt";
        const concatText = segmentNames.map(f => `file '${f}'`).join("\n");
        await ffmpeg.writeFile(concatTxtName, concatText);
        
        const concatArgs = [
            "-f", "concat",
            "-safe", "0",
            "-i", concatTxtName,
            "-map", "0:v:0",
            "-map", "0:a?",
            "-c:v", "libx264",
            "-preset", "ultrafast",
            "-pix_fmt", "yuv420p",
        ];
        if (format === "mp4-muted") {
          concatArgs.push("-an");
        } else {
          concatArgs.push("-c:a", "aac", "-b:a", "128k", "-ar", "44100");
        }
        concatArgs.push("-movflags", "+faststart", finalOutputName);
        await ffmpeg.exec(concatArgs);
    }

    const data = await ffmpeg.readFile(finalOutputName);
    const blob = new Blob([data], { type: format === "mp3" ? "audio/mpeg" : "video/mp4" });
    const url = URL.createObjectURL(blob);
    
    // --- MEMORY CLEANUP OPTIMIZATION ---
    // Delete all virtual files to prevent RAM usage from ballooning on consecutive exports
    try {
        await ffmpeg.deleteFile(inputName);
        await ffmpeg.deleteFile("concat.txt");
        await ffmpeg.deleteFile(finalOutputName);
        for (const segment of segmentNames) {
            await ffmpeg.deleteFile(segment);
        }
        console.log("Memoria RAM limpiada con éxito. Listo para la próxima exportación.");
    } catch (cleanupError) {
        console.warn("Advertencia: No se pudo limpiar alguna porción de memoria", cleanupError);
    }
    
    // Provide blob URL
    return url;
  };

  return {
    loaded,
    loading,
    progress,
    renderVideo,
  };
}
