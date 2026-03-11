import { useState, useRef, useEffect } from "react";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

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
    startTime: number,
    endTime: number,
    zoomVal: number,
    posXVal: number,
    posYVal: number,
    format: "mp4" | "mp3" | "mp4-muted",
    originalWidth: number,
    originalHeight: number,
    resolution: { w: number, h: number }
  ) => {
    const ffmpeg = ffmpegRef.current;
    const inputName = "input.mp4";
    const ext = format.startsWith("mp4") ? "mp4" : format;
    const outputName = `output.${ext}`;
    
    await ffmpeg.writeFile(inputName, await fetchFile(videoFile));

    // Calculate scaling to "contain" the video inside the target resolution first
    const targetW = resolution.w;
    const targetH = resolution.h;
    const scaleX = targetW / originalWidth;
    const scaleY = targetH / originalHeight;
    const baseScale = Math.min(scaleX, scaleY);
    
    // Zoom: 10 to 500 -> multiplier 0.1 to 5.0
    const finalZoom = zoomVal / 100; 
    
    const finalW = originalWidth * baseScale * finalZoom;
    const finalH = originalHeight * baseScale * finalZoom;
    
    // Ensure all dimensions are even (FFmpeg requirement for libx264)
    const fw = Math.floor(finalW / 2) * 2;
    const fh = Math.floor(finalH / 2) * 2;
    const cw = Math.floor(targetW / 2) * 2;
    const ch = Math.floor(targetH / 2) * 2;
    
    // Calculate the absolute X and Y of the video on the canvas. 
    // If posX is 50, it is centered. If posX is 0, it pushes the video right (by +50%).
    const videoX = Math.round((cw - fw) / 2 + ((50 - posXVal) / 100) * fw);
    const videoY = Math.round((ch - fh) / 2 + ((50 - posYVal) / 100) * fh);
    
    const dur = endTime - startTime;

    // Apply trim params as inputs for much faster processing
    let argList = [
      "-ss", startTime.toFixed(3), 
      "-t", dur.toFixed(3),
      "-i", inputName
    ];
    
    if (format === "mp4" || format === "mp4-muted") {
      // Create a black canvas of the exact target resolution and overlay the manipulated video.
      // Overlay supports negative x/y naturally for zooming/cropping!
      const filterComplex = `color=c=black:s=${cw}x${ch}[bg];[0:v]scale=${fw}:${fh}[vid];[bg][vid]overlay=x=${videoX}:y=${videoY}:shortest=1[outv]`;
      
      argList.push(
        "-filter_complex", filterComplex,
        "-map", "[outv]"
      );

      if (format === "mp4") {
        argList.push("-map", "0:a?", "-c:a", "aac"); // Include audio if present and re-encode
      } else {
        argList.push("-an"); // Strip audio explicitly
      }

      argList.push(
        "-c:v", "libx264", 
        "-preset", "ultrafast"
      );
    } else {
      // Audio only for mp3
      argList.push("-vn", "-c:a", "libmp3lame");
    }
    
    argList.push(outputName);
    
    setProgress(0);
    const code = await ffmpeg.exec(argList);
    
    if (code !== 0) {
      throw new Error(`FFmpeg execution failed with error code: ${code}`);
    }
    
    const data = await ffmpeg.readFile(outputName);
    const blob = new Blob([data as any], { type: format.startsWith("mp4") ? "video/mp4" : "audio/mpeg" });
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
