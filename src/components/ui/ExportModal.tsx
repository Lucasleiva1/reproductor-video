"use client";

import { useTimeline } from "@/hooks/useTimeline";
import { useFFmpeg } from "@/hooks/useFFmpeg";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState, useEffect, useRef } from "react";
import { DownloadCloud, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslation } from "react-i18next";

export default function ExportModal() {
  const { t } = useTranslation();
  const { videoFile, startTime, endTime, zoom, posX, posY, resolution } = useTimeline();
  const { loaded, loading, progress, renderVideo } = useFFmpeg();

  const [isOpen, setIsOpen] = useState(false);
  const [format, setFormat] = useState<"mp4" | "mp3" | "mp4-muted">("mp4");
  const [rendering, setRendering] = useState(false);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const lastFileNameRef = useRef<string>("");

  // Generate random filename: 3 letters + 5 digits, never repeats previous
  const generateFileName = () => {
    const letters = 'abcdefghijklmnopqrstuvwxyz';
    let name = '';
    do {
      let chars = '';
      for (let i = 0; i < 3; i++) chars += letters[Math.floor(Math.random() * 26)];
      let nums = '';
      for (let i = 0; i < 5; i++) nums += Math.floor(Math.random() * 10).toString();
      name = chars + nums;
    } while (name === lastFileNameRef.current);
    lastFileNameRef.current = name;
    return name;
  };

  const handleRender = async () => {
    if (!videoFile || !loaded) return;
    setRendering(true);
    setResultUrl(null);

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
        tempVideo.videoHeight,
        resolution
      );
      setResultUrl(url);
    } catch (e) {
      console.error(e);
    } finally {
      setRendering(false);
    }
  };

  const handleDownload = async () => {
    if (!resultUrl) return;
    const ext = format.startsWith("mp4") ? "mp4" : format;
    const fileName = `${generateFileName()}.${ext}`;

    // Try File System Access API (lets user choose where to save)
    if ('showSaveFilePicker' in window) {
      try {
        const mimeMap: Record<string, string> = {
          mp4: 'video/mp4',
          mp3: 'audio/mpeg',
        };
        const handle = await (window as any).showSaveFilePicker({
          suggestedName: fileName,
          types: [{
            description: ext.toUpperCase() + ' File',
            accept: { [mimeMap[ext] || 'application/octet-stream']: ['.' + ext] },
          }],
        });
        const writable = await handle.createWritable();
        const response = await fetch(resultUrl);
        const blob = await response.blob();
        await writable.write(blob);
        await writable.close();
        setIsOpen(false);
        return;
      } catch (err: any) {
        // User cancelled the picker — fall through to classic download
        if (err?.name === 'AbortError') return;
      }
    }

    // Fallback: classic download
    const a = document.createElement("a");
    a.href = resultUrl;
    a.download = fileName;
    a.click();
    setIsOpen(false);
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
        className="font-semibold shadow-lg transition-transform hover:scale-105 active:scale-95 bg-blue-600 hover:bg-blue-700 text-white"
      >
        {loading ? <Loader2 className="animate-spin w-4 h-4 mr-2" /> : <DownloadCloud className="w-4 h-4 mr-2" />}
        {t('quick_export')}
      </Button>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="sm:max-w-md bg-background/95 backdrop-blur-xl border border-border shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-xl">{t('export_media')}</DialogTitle>
            <DialogDescription>
              {t('export_desc')}
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
                  <label className="text-sm font-medium">{t('output_format')}</label>
                  <Select value={format} onValueChange={(val) => val && setFormat(val as "mp4" | "mp3" | "mp4-muted")}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={t('format')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="mp4">{t('video_mp4')}</SelectItem>
                      <SelectItem value="mp4-muted">{t('video_mp4_muted')}</SelectItem>
                      <SelectItem value="mp3">{t('audio_mp3')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="grid grid-cols-2 gap-4 text-sm text-muted-foreground bg-muted p-4 rounded-md">
                   <div>
                     <span className="block font-semibold">{t('start')}:</span> {startTime.toFixed(2)}s
                   </div>
                   <div>
                     <span className="block font-semibold">{t('end')}:</span> {endTime.toFixed(2)}s
                   </div>
                   <div>
                     <span className="block font-semibold">{t('resolution')}:</span> {resolution.name}
                   </div>
                   <div>
                     <span className="block font-semibold">{t('zoom_scale')}:</span> {(zoom / 100).toFixed(1)}x
                   </div>
                   <div>
                     <span className="block font-semibold">{t('local_ffmpeg')}:</span> {loaded ? t('ready') : t('loading')}
                   </div>
                </div>

                <div className="flex justify-end gap-2 mt-4">
                   <Button variant="ghost" onClick={() => setIsOpen(false)}>{t('cancel')}</Button>
                   <Button onClick={handleRender} className="bg-blue-600 text-white hover:bg-blue-700">{t('start_render')}</Button>
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
                  <div className="text-lg font-medium">{t('rendering')}</div>
                  <Progress value={progress} className="h-3 w-full" />
                  <div className="text-sm text-muted-foreground font-mono">{progress}% {t('complete')}</div>
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
                 <div className="text-lg font-semibold text-center">{t('render_complete')}</div>
                 <Button onClick={handleDownload} size="lg" className="w-full font-bold">
                   {t('download_file')}
                 </Button>
               </motion.div>
            ) : null}
          </AnimatePresence>
        </DialogContent>
      </Dialog>
    </>
  );
}
