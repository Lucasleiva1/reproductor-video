"use client";

import { useTimeline } from "@/hooks/useTimeline";
import { useFFmpeg } from "@/hooks/useFFmpeg";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState, useEffect } from "react";
import { DownloadCloud, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function ExportModal() {
  const { videoFile, startTime, endTime, zoom, posX, posY } = useTimeline();
  const { loaded, loading, progress, renderVideo } = useFFmpeg();

  const [isOpen, setIsOpen] = useState(false);
  const [format, setFormat] = useState<"mp4" | "mp3">("mp4");
  const [rendering, setRendering] = useState(false);
  const [resultUrl, setResultUrl] = useState<string | null>(null);

  const handleRender = async () => {
    if (!videoFile || !loaded) return;
    setRendering(true);
    setResultUrl(null);

    // Get original video dimensions to pass to renderVideo
    const tempVideo = document.createElement("video");
    tempVideo.src = URL.createObjectURL(videoFile);
    await new Promise((resolve) => {
      tempVideo.onloadedmetadata = () => resolve(true);
    });

    try {
      const url = await renderVideo(
        videoFile,
        startTime,
        endTime,
        zoom,
        posX,
        posY,
        format,
        tempVideo.videoWidth,
        tempVideo.videoHeight
      );
      setResultUrl(url);
    } catch (e) {
      console.error(e);
    } finally {
      setRendering(false);
    }
  };

  const handleDownload = () => {
    if (resultUrl) {
      const a = document.createElement("a");
      a.href = resultUrl;
      a.download = `exported-video.${format}`;
      a.click();
      setIsOpen(false);
    }
  };

  useEffect(() => {
    if (!isOpen) {
      setResultUrl(null);
      setRendering(false);
    }
  }, [isOpen]);

  return (
    <>
      <Button 
        variant="default" 
        onClick={() => setIsOpen(true)}
        disabled={!videoFile || loading}
        className="w-full font-semibold shadow-lg transition-transform hover:scale-105 active:scale-95 bg-blue-600 hover:bg-blue-700 text-white"
      >
        {loading ? <Loader2 className="animate-spin w-4 h-4 mr-2" /> : <DownloadCloud className="w-4 h-4 mr-2" />}
        Quick Export
      </Button>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="sm:max-w-md bg-background/95 backdrop-blur-xl border border-border shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-xl">Export Media</DialogTitle>
            <DialogDescription>
              Render your Quick-Cutter edits via local browser FFmpeg.wasm.
            </DialogDescription>
          </DialogHeader>

          <AnimatePresence mode="wait">
            {!rendering && !resultUrl ? (
              <motion.div 
                 key="setup"
                 initial={{ opacity: 0, y: 10 }} 
                 animate={{ opacity: 1, y: 0 }} 
                 exit={{ opacity: 0, y: -10 }}
                 className="flex flex-col gap-6 py-4"
              >
                <div className="space-y-3">
                  <label className="text-sm font-medium">Output Format</label>
                  <Select value={format} onValueChange={(val) => val && setFormat(val as "mp4" | "mp3")}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Format" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="mp4">Video (MP4)</SelectItem>
                      <SelectItem value="mp3">Audio Only (MP3)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="grid grid-cols-2 gap-4 text-sm text-muted-foreground bg-muted p-4 rounded-md">
                   <div>
                     <span className="block font-semibold">Start:</span> {startTime.toFixed(2)}s
                   </div>
                   <div>
                     <span className="block font-semibold">End:</span> {endTime.toFixed(2)}s
                   </div>
                   <div>
                     <span className="block font-semibold">Zoom Scale:</span> {(1 + (zoom / 100) * 4).toFixed(1)}x
                   </div>
                   <div>
                     <span className="block font-semibold">Local FFmpeg:</span> {loaded ? "Ready" : "Loading"}
                   </div>
                </div>

                <div className="flex justify-end gap-2 mt-4">
                   <Button variant="ghost" onClick={() => setIsOpen(false)}>Cancel</Button>
                   <Button onClick={handleRender} className="bg-blue-600 text-white hover:bg-blue-700">Start Render</Button>
                </div>
              </motion.div>
            ) : rendering ? (
              <motion.div 
                 key="progress"
                 initial={{ opacity: 0, scale: 0.95 }} 
                 animate={{ opacity: 1, scale: 1 }} 
                 exit={{ opacity: 0, scale: 0.95 }}
                 className="flex flex-col items-center justify-center py-10 gap-6"
              >
                <Loader2 className="w-12 h-12 text-blue-500 animate-spin" />
                <div className="w-full space-y-2 text-center">
                  <div className="text-lg font-medium">Rendering Frame by Frame...</div>
                  <Progress value={progress} className="h-3 w-full" />
                  <div className="text-sm text-muted-foreground font-mono">{progress}% Complete</div>
                </div>
              </motion.div>
            ) : resultUrl ? (
              <motion.div 
                 key="done"
                 initial={{ opacity: 0, scale: 0.9 }} 
                 animate={{ opacity: 1, scale: 1 }}
                 className="flex flex-col items-center justify-center py-8 gap-6"
               >
                 <div className="w-16 h-16 rounded-full bg-green-500/20 text-green-500 flex items-center justify-center">
                   <DownloadCloud className="w-8 h-8" />
                 </div>
                 <div className="text-lg font-semibold text-center">Render Complete!</div>
                 <Button onClick={handleDownload} size="lg" className="w-full font-bold">
                   Download File
                 </Button>
               </motion.div>
            ) : null}
          </AnimatePresence>
        </DialogContent>
      </Dialog>
    </>
  );
}
