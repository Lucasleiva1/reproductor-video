"use client";

import Canvas from "@/components/editor/Canvas";
import Timeline from "@/components/editor/Timeline";
import Inspector from "@/components/editor/Inspector";
import ExportModal from "@/components/ui/ExportModal";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { useTimeline, RESOLUTIONS } from "@/hooks/useTimeline";
import { Button } from "@/components/ui/button";
import { Upload, ChevronRight, ChevronLeft, LayoutPanelLeft, Keyboard } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTranslation } from "react-i18next";
import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export default function Home() {
  const [showInspector, setShowInspector] = useState(true);
  const { t, i18n } = useTranslation();
  const { setVideoFile, resolution, setResolution, currentTime, duration, playing, setPlaying, setCurrentTime, canvasScale, setCanvasScale } = useTimeline();

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      setVideoFile(file, url);
    }
  };

  // --- Timecode formatter ---
  const formatTimecode = useCallback((seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 100);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
  }, []);

  // --- Global Keyboard Shortcuts ---
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      // Don't fire shortcuts when typing in inputs
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      switch (e.code) {
        case 'Space':
          e.preventDefault();
          setPlaying(!useTimeline.getState().playing);
          break;
        case 'KeyJ':
          setCurrentTime(Math.max(0, useTimeline.getState().currentTime - 5));
          break;
        case 'KeyL':
          setCurrentTime(Math.min(useTimeline.getState().duration, useTimeline.getState().currentTime + 5));
          break;
        case 'ArrowLeft':
          e.preventDefault();
          setCurrentTime(Math.max(0, useTimeline.getState().currentTime - (1 / 30)));
          break;
        case 'ArrowRight':
          e.preventDefault();
          setCurrentTime(Math.min(useTimeline.getState().duration, useTimeline.getState().currentTime + (1 / 30)));
          break;
        case 'Equal': // + key
        case 'NumpadAdd':
          setCanvasScale(Math.min(3, useTimeline.getState().canvasScale + 0.1));
          break;
        case 'Minus': // - key
        case 'NumpadSubtract':
          setCanvasScale(Math.max(0.1, useTimeline.getState().canvasScale - 0.1));
          break;
      }
    };

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [setPlaying, setCurrentTime, setCanvasScale]);

  return (
    <div className="h-screen flex flex-col bg-background text-foreground overflow-hidden">
      {/* Header */}
      <header className="h-14 border-b border-border px-6 flex items-center justify-between bg-background/95 backdrop-blur-md z-10 shrink-0">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-emerald-400">
            {t('app_name')}
          </h1>
          <span className="text-xs font-mono text-muted-foreground border border-border px-2 py-0.5 rounded-full">v1.0.0</span>

          {/* Timecode Display */}
          {duration > 0 && (
            <div className="hidden sm:flex items-center gap-2 bg-muted/50 border border-border rounded-md px-3 py-1">
              <span className="text-sm font-mono font-semibold text-blue-400 tabular-nums tracking-wider">
                {formatTimecode(currentTime)}
              </span>
              <span className="text-[10px] text-muted-foreground">/</span>
              <span className="text-xs font-mono text-muted-foreground tabular-nums">
                {formatTimecode(duration)}
              </span>
            </div>
          )}
        </div>
        
        <div className="flex items-center gap-4">
          <div className="relative overflow-hidden group">
            <input
              type="file"
              accept="video/*"
              className="absolute inset-0 opacity-0 cursor-pointer w-full h-full z-10"
              onChange={handleFileUpload}
            />
            <Button variant="outline" className="gap-2 bg-muted/50 transition-colors group-hover:bg-muted group-hover:text-foreground">
              <Upload className="w-4 h-4" />
              {t('change_video')}
            </Button>
          </div>
          
          <Select 
            value={resolution.name} 
            onValueChange={(val) => setResolution(RESOLUTIONS.find(r => r.name === val)!)}
          >
            <SelectTrigger className="w-[200px] bg-muted/50 border-border h-9 text-xs">
              <SelectValue placeholder={t('resolution')} />
            </SelectTrigger>
            <SelectContent>
              {RESOLUTIONS.map(r => (
                <SelectItem key={r.name} value={r.name} className="text-xs">{r.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <ThemeToggle />

          {/* Keyboard Shortcuts Tooltip */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger>
                <Button variant="ghost" size="icon" className="w-9 h-9 text-muted-foreground hover:text-foreground">
                  <Keyboard className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" align="end" className="max-w-xs">
                <p className="font-semibold mb-2">{t('keyboard_shortcuts')}</p>
                <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
                  <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">Space</kbd>
                  <span>{t('shortcut_play')}</span>
                  <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">J</kbd>
                  <span>{t('shortcut_back')}</span>
                  <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">L</kbd>
                  <span>{t('shortcut_forward')}</span>
                  <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">←</kbd>
                  <span>{t('shortcut_frame_back')}</span>
                  <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">→</kbd>
                  <span>{t('shortcut_frame_forward')}</span>
                  <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">+</kbd>
                  <span>{t('shortcut_zoom_in')}</span>
                  <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">-</kbd>
                  <span>{t('shortcut_zoom_out')}</span>
                </div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <ExportModal />
          
          <Select value={i18n.resolvedLanguage || 'es'} onValueChange={(val) => i18n.changeLanguage(val as string)}>
            <SelectTrigger className="w-[60px] bg-muted/50 border-border h-9 text-xs font-semibold focus:ring-0 uppercase">
              {i18n.resolvedLanguage ? i18n.resolvedLanguage.toUpperCase() : 'ES'}
            </SelectTrigger>
            <SelectContent align="end">
              <SelectItem value="es" className="text-xs">Español</SelectItem>
              <SelectItem value="en" className="text-xs">English</SelectItem>
              <SelectItem value="pt" className="text-xs">Português</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </header>

      {/* Main Editing Area */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Top: Video Preview Workspace */}
        <div className="flex-1 bg-[#121212] flex flex-col relative w-full border-b border-border shadow-inner">
          <Canvas />

          {/* Canvas Zoom Indicator */}
          {duration > 0 && (
            <div className="absolute bottom-3 left-3 z-20 bg-black/60 backdrop-blur-sm text-white text-[11px] font-mono px-2.5 py-1 rounded-md border border-white/10 select-none tabular-nums">
              {t('canvas_zoom')}: {(canvasScale * 100).toFixed(0)}%
            </div>
          )}
        </div>
        
        {/* Bottom Panel: Editing Tools */}
        <div className="h-[22rem] bg-background flex shrink-0 w-full z-10 relative">
          <div className="flex-1 flex flex-col h-full border-r border-border overflow-hidden">
             <Timeline />
          </div>

          <motion.div
             initial={false}
             animate={{ width: showInspector ? 400 : 0 }}
             className="shrink-0 h-full overflow-hidden bg-muted/10 border-l border-border relative flex"
          >
             <div className="w-[400px] h-full overflow-y-auto shrink-0">
               <Inspector onClose={() => setShowInspector(false)} />
             </div>
          </motion.div>

          <AnimatePresence>
            {!showInspector && (
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                className="absolute top-4 right-4 z-50"
              >
                 <Button
                    variant="secondary"
                    size="icon"
                    onClick={() => setShowInspector(true)}
                    className="w-10 h-10 rounded-full shadow-lg border border-border"
                    title={t('inspector')}
                 >
                    <LayoutPanelLeft className="w-5 h-5" />
                 </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
