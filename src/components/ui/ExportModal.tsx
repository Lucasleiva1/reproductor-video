import { useTimeline } from "@/hooks/useTimeline";
import { useShallow } from "zustand/react/shallow";
import { buildRenderJob, cancelRender, copyFileToTemp, deleteTempCopy, probeHasAudio, revealInFolder, runRender } from "@/hooks/useFFmpeg";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState, useEffect, useRef } from "react";
import { DownloadCloud, FolderOpen, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslation } from "react-i18next";

const readVideoSize = (src: string) =>
  new Promise<{ width: number; height: number }>((resolve, reject) => {
    const probe = document.createElement("video");
    probe.preload = "metadata";
    probe.onloadedmetadata = () => {
      resolve({ width: probe.videoWidth, height: probe.videoHeight });
      probe.removeAttribute("src");
      probe.load();
    };
    probe.onerror = () => reject(new Error("No se pudieron leer las medidas del video."));
    probe.src = src;
  });

export default function ExportModal() {
  const { t } = useTranslation();
  // Subscribe only to what this component uses (not to every playback frame)
  const { videoFile, videoPath, clips, zoom, posX, posY, resolution, colorCorrection } = useTimeline(useShallow((s) => ({ videoFile: s.videoFile, videoPath: s.videoPath, clips: s.clips, zoom: s.zoom, posX: s.posX, posY: s.posY, resolution: s.resolution, colorCorrection: s.colorCorrection })));

  const [isOpen, setIsOpen] = useState(false);
  const [format, setFormat] = useState<"mp4" | "mp3" | "mp4-muted">("mp4");
  const [rendering, setRendering] = useState(false);
  const [stage, setStage] = useState<"preparing" | "rendering">("rendering");
  const [progress, setProgress] = useState(0);
  const [resultPath, setResultPath] = useState<string | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const lastFileNameRef = useRef<string>("");

  // Generate random filename: 20 digits, never repeats previous
  const generateFileName = () => {
    let name = '';
    do {
      let nums = '';
      for (let i = 0; i < 20; i++) nums += Math.floor(Math.random() * 10).toString();
      name = nums;
    } while (name === lastFileNameRef.current);
    lastFileNameRef.current = name;
    return name;
  };

  const handleRender = async () => {
    if (!videoFile && !videoPath) return;
    setRendering(true);
    setResultPath(null);
    setRenderError(null);
    setProgress(0);

    let tempCopy: string | null = null;
    let objectUrl = "";
    try {
      let inputPath: string;
      let size: { width: number; height: number };
      if (videoPath) {
        const { convertFileSrc } = await import("@tauri-apps/api/tauri");
        inputPath = videoPath;
        size = await readVideoSize(convertFileSrc(videoPath));
      } else {
        // Opened from the file picker: no disk path, so ffmpeg gets a temporary copy
        // that is deleted in `finally` (and swept on the next start if the app dies)
        objectUrl = URL.createObjectURL(videoFile!);
        size = await readVideoSize(objectUrl);
        setStage("preparing");
        tempCopy = await copyFileToTemp(videoFile!, (ratio) => setProgress(Math.round(ratio * 100)));
        inputPath = tempCopy;
      }

      setStage("rendering");
      setProgress(0);
      const ext = format.startsWith("mp4") ? "mp4" : "mp3";
      const job = buildRenderJob({
        inputPath,
        hasAudio: format === "mp4-muted" ? false : await probeHasAudio(inputPath),
        clips,
        zoom,
        posX,
        posY,
        format,
        sourceWidth: size.width,
        sourceHeight: size.height,
        resolution,
        colorCorrection,
        fileName: `${generateFileName()}.${ext}`,
      });
      const saved = await runRender(job, (ratio) => setProgress(Math.round(ratio * 100)));
      setResultPath(saved);
    } catch (e) {
      const message = String((e as Error)?.message ?? e);
      if (message !== "CANCELADO") {
        console.error(e);
        setRenderError(message);
      }
    } finally {
      if (tempCopy) await deleteTempCopy(tempCopy);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setRendering(false);
    }
  };

  useEffect(() => {
    if (!isOpen) {
      setResultPath(null);
      setRenderError(null);
    }
  }, [isOpen]);

  // Closing the dialog mid-export stops ffmpeg instead of leaving it running unseen
  const handleOpenChange = (open: boolean) => {
    if (!open && rendering) cancelRender();
    setIsOpen(open);
  };

  return (
    <>
      <Button
        variant="default"
        onClick={() => setIsOpen(true)}
        disabled={!videoFile && !videoPath}
        className="font-semibold shadow-lg transition-transform hover:scale-105 active:scale-95 bg-blue-600 hover:bg-blue-700 text-white"
      >
        <span className="w-4 h-4 mr-2 inline-flex items-center justify-center">
          {rendering ? <Loader2 className="animate-spin w-4 h-4" /> : <DownloadCloud className="w-4 h-4" />}
        </span>
        {t('quick_export')}
      </Button>

      <Dialog open={isOpen} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-md bg-background/95 backdrop-blur-xl border border-border shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-xl">{t('export_media')}</DialogTitle>
            <DialogDescription>
              {t('export_desc')}
            </DialogDescription>
          </DialogHeader>

          <AnimatePresence mode="wait">
            {!rendering && !resultPath ? (
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
                    <SelectTrigger className="w-full" aria-label={t('output_format')}>
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
                     <span className="block font-semibold">Clips:</span> {clips.length}
                   </div>
                   <div>
                     <span className="block font-semibold">{t('resolution')}:</span> {resolution.name}
                   </div>
                   <div>
                     <span className="block font-semibold">{t('zoom_scale')}:</span> {(zoom / 100).toFixed(1)}x
                   </div>
                   <div>
                     <span className="block font-semibold">{t('local_ffmpeg')}:</span> {t('ready')}
                   </div>
                </div>

                <div className="flex justify-end gap-2 mt-4">
                   <Button variant="ghost" onClick={() => setIsOpen(false)}>{t('cancel')}</Button>
                   <Button onClick={handleRender} className="bg-blue-600 text-white hover:bg-blue-700">{t('start_render')}</Button>
                </div>
                {renderError && (
                  <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-400">
                    <p className="font-semibold">{t('render_error')}</p>
                    <p className="mt-1 max-h-32 overflow-auto overscroll-contain whitespace-pre-wrap break-all font-mono text-xs">{renderError}</p>
                  </div>
                )}
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
                  <div className="text-lg font-medium">{stage === "preparing" ? t('preparing_video') : t('rendering')}</div>
                  <Progress value={progress} className="h-3 w-full" />
                  <div className="text-sm text-muted-foreground font-mono">{progress}% {t('complete')}</div>
                </div>
                <Button variant="ghost" onClick={() => cancelRender()}>{t('cancel_render')}</Button>
              </motion.div>
            ) : resultPath ? (
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
                 <p className="w-full break-all text-center text-xs text-muted-foreground">
                   {t('saved_in')}: {resultPath}
                 </p>
                 <div className="flex w-full gap-2">
                   <Button variant="ghost" onClick={() => setIsOpen(false)} className="flex-1">{t('close')}</Button>
                   <Button onClick={() => revealInFolder(resultPath)} size="lg" className="flex-1 font-bold">
                     <FolderOpen className="w-4 h-4 mr-2" />
                     {t('open_folder')}
                   </Button>
                 </div>
               </motion.div>
            ) : null}
          </AnimatePresence>
        </DialogContent>
      </Dialog>
    </>
  );
}
