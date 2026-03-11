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

    // Calculate scaling to "contain" the video inside the target resolution (letterbox)
    // This preserves aspect ratio and adds equal black bars when centered, like DaVinci Resolve
    const targetW = resolution.w;
    const targetH = resolution.h;
    const scaleX = targetW / originalWidth;
    const scaleY = targetH / originalHeight;
    // Math.min = contain (fit inside, with letterbox bars if aspect ratios differ)
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
    
    // Calculate overlay position on the black canvas.
    // posX/posY range 0-100, where 50 = centered.
    // When centered (50): videoX = (cw - fw) / 2 → equal bars on both sides.
    // The offset is relative to the canvas size for intuitive panning.
    const centerX = (cw - fw) / 2;
    const centerY = (ch - fh) / 2;
    const offsetX = ((posXVal - 50) / 50) * centerX;  // posX > 50 moves right
    const offsetY = ((posYVal - 50) / 50) * centerY;  // posY > 50 moves down
    const videoX = Math.round(centerX + offsetX);
    const videoY = Math.round(centerY + offsetY);
    
    const dur = endTime - startTime;

    // Apply trim params as inputs for much faster processing
    let argList = [
      "-ss", startTime.toFixed(3), 
      "-t", dur.toFixed(3),
      "-i", inputName
    ];
    
    if (format === "mp4" || format === "mp4-muted") {
      // Create a black canvas, scale the video to fit (contain), and overlay centered.
      // Overlay supports negative x/y naturally for panning/zooming.
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
