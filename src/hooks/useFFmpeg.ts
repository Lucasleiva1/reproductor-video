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
    format: "mp4" | "mp3",
    originalWidth: number,
    originalHeight: number
  ) => {
    const ffmpeg = ffmpegRef.current;
    const inputName = "input.mp4";
    const outputName = `output.${format}`;
    
    await ffmpeg.writeFile(inputName, await fetchFile(videoFile));

    // Calculate crop parameters
    // Zoom: 10 to 500 -> scale 0.1x to 5.0x
    const scale = zoomVal / 100; 
    
    const cropW = originalWidth / scale;
    const cropH = originalHeight / scale;
    
    const maxPosX = originalWidth - cropW;
    const maxPosY = originalHeight - cropH;
    
    const cropX = (posXVal / 100) * maxPosX;
    const cropY = (posYVal / 100) * maxPosY;

    const w = Math.floor(cropW / 2) * 2;
    const h = Math.floor(cropH / 2) * 2;
    const x = Math.floor(cropX / 2) * 2;
    const y = Math.floor(cropY / 2) * 2;
    
    const dur = endTime - startTime;

    // Apply trim params as inputs for much faster processing
    const argList = [
      "-ss", startTime.toFixed(3), 
      "-t", dur.toFixed(3),
      "-i", inputName
    ];
    
    if (format === "mp4") {
      // Crop for Mp4 and encode incredibly fast
      argList.push("-vf", `crop=${w}:${h}:${x}:${y}`);
      argList.push("-c:v", "libx264", "-preset", "ultrafast", "-c:a", "copy");
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
    const blob = new Blob([data as any], { type: format === "mp4" ? "video/mp4" : "audio/mpeg" });
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
