import { useState, useRef, useEffect } from "react";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
import { Clip, Resolution } from "@/hooks/useTimeline";

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
    const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd";
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
    videoFile: File,
    clips: Clip[], // Replaced startTime/endTime with clips array
    zoom: number,
    posX: number,
    posY: number,
    format: "mp4" | "mp3" | "mp4-muted",
    sourceWidth: number,
    sourceHeight: number,
    resolution: Resolution
  ) => {
    if (!ffmpegRef.current) throw new Error("FFmpeg not loaded");
    const ffmpeg = ffmpegRef.current;

    const inputName = "input.mp4";
    const finalOutputName = `output.${format.startsWith("mp4") ? "mp4" : "mp3"}`;

    await ffmpeg.writeFile(inputName, await fetchFile(videoFile));

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

    const translateXPercent = ((posX - 50) * -1) / 100;
    const translateYPercent = ((posY - 50) * -1) / 100;
    
    let videoX = Math.round((targetW - scaledInternalW) / 2 + (targetW * translateXPercent));
    let videoY = Math.round((targetH - scaledInternalH) / 2 + (targetH * translateYPercent));

    if (scaledInternalW % 2 !== 0) videoX += 1;
    if (scaledInternalH % 2 !== 0) videoY += 1;

    // Process each clip individually and store the partial output filenames
    const segmentNames: string[] = [];
    let currentTimelineTime = 0;

    // Order clips by global timeline start time (startAt)
    const sortedClips = [...clips].sort((a, b) => a.startAt - b.startAt);

    for (let i = 0; i < sortedClips.length; i++) {
        const clip = sortedClips[i];
        
        // Check for gap BEFORE this clip
        if (clip.startAt > currentTimelineTime) {
            const gapDuration = clip.startAt - currentTimelineTime;
            const gapName = `gap_${i}.mp4`;
            segmentNames.push(gapName);
            
            console.log(`Generating black gap segment: ${gapDuration}s`);
            // Generate a black segment with silent audio for the gap
            await ffmpeg.exec([
                "-f", "lavfi", "-i", `color=c=black:s=${targetW}x${targetH}:r=30`,
                "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
                "-t", gapDuration.toString(),
                "-c:v", "libx264", "-preset", "ultrafast",
                "-c:a", "aac",
                gapName
            ]);
        }

        const clipDuration = clip.trimEnd - clip.trimStart;
        const segmentName = `segment_${i}.mp4`;
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
                "-filter_complex", `[0:v]scale=${scaledInternalW}:${scaledInternalH}[scaled];[scaled]pad=${targetW}:${targetH}:${videoX}:${videoY}:black[out]`,
                "-map", "[out]",
                "-map", "0:a?"
            );
            if (format === "mp4-muted") {
                args.push("-an");
            } else {
                args.push("-c:a", "aac", "-b:a", "128k");
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
            "-c", "copy",
            finalOutputName
        ]);
    } else {
        // Concat the video segments
        const concatTxtName = "concat.txt";
        const concatText = segmentNames.map(f => `file '${f}'`).join("\n");
        await ffmpeg.writeFile(concatTxtName, concatText);
        
        await ffmpeg.exec([
            "-f", "concat",
            "-safe", "0",
            "-i", concatTxtName,
            "-c", "copy",
            finalOutputName
        ]);
    }

    const data = await ffmpeg.readFile(finalOutputName);
    const blob = new Blob([data], { type: format === "mp3" ? "audio/mpeg" : "video/mp4" });
    const url = URL.createObjectURL(blob);
    
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
