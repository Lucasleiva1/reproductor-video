
import Canvas from "@/components/editor/Canvas";
import Timeline from "@/components/editor/Timeline";
import Inspector from "@/components/editor/Inspector";
import ExportModal from "@/components/ui/ExportModal";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { useTimeline, RESOLUTIONS } from "@/hooks/useTimeline";
import { Button } from "@/components/ui/button";
import { Upload, LayoutPanelLeft, Keyboard, BookOpen } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTranslation } from "react-i18next";
import { useState, useEffect, Suspense } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export default function Home() {
  const [showInspector, setShowInspector] = useState(true);
  const { t, i18n } = useTranslation();
  const { setVideoFile, loadVideoByPath, resolution, setResolution, duration, setPlaying, setCurrentTime, canvasScale, setCanvasScale, isFullscreen, setIsFullscreen, headerShowLang, headerShowRes, headerShowShortcuts, headerShowTheme, headerShowTutorial } = useTimeline();
  
  // --- Tauri File Open Handler ---
  useEffect(() => {
    let unlisten: any;
    
    const setupListener = async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        const { invoke } = await import("@tauri-apps/api/tauri");
        const { appWindow } = await import("@tauri-apps/api/window");

        const enterFullscreenPlayer = async () => {
          try {
            // Set transitioning flag so resize handler doesn't interfere
            useTimeline.getState().setFsTransitioning(true);
            await appWindow.setDecorations(false);
            await appWindow.setFullscreen(true);
            setIsFullscreen(true);
            // Small delay to let the window settle, then release the flag
            setTimeout(() => {
              useTimeline.getState().setFsTransitioning(false);
            }, 500);
          } catch (e) {
            useTimeline.getState().setFsTransitioning(false);
            console.error("Failed to enter fullscreen", e);
          }
        };

        const VIDEO_EXTS = ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.m4v', '.flv', '.wmv', '.mpg', '.mpeg', '.3gp', '.ogv', '.ts', '.mts', '.m2ts', '.vob', '.divx', '.f4v', '.asf', '.rm', '.rmvb', '.3g2', '.mxf', '.dv'];

        // 1. Listen for future path selections (single instance)
        unlisten = await listen("path-selected", async (event: any) => {
          const paths = event.payload as string[];
          if (paths && paths.length > 0) {
            const videoPath = paths.find(p => 
              VIDEO_EXTS.some(ext => p.toLowerCase().replace(/["']/g, '').endsWith(ext))
            );
            if (videoPath) {
              const cleanPath = videoPath.replace(/^["']|["']$/g, '');
              // Ensure Tauri allows access to this file
              try { await invoke('allow_file_access', { path: cleanPath }); } catch(_) {}
              loadVideoByPath(cleanPath, true);
              enterFullscreenPlayer();
            }
          }
        });

        // 2. Check for initial path (first launch)
        const initialPath = await invoke<string | null>("get_initial_path");
        if (initialPath) {
          const cleanPath = initialPath.replace(/^["']|["']$/g, '');
          const isVideo = VIDEO_EXTS.some(ext => cleanPath.toLowerCase().endsWith(ext));
          if (isVideo) {
            // Ensure Tauri allows access to this file
            try { await invoke('allow_file_access', { path: cleanPath }); } catch(_) {}
            loadVideoByPath(cleanPath, true);
            enterFullscreenPlayer();
          }
        }
      } catch (err) {
        console.error("Tauri event error:", err);
      }
    };

    setupListener();
    return () => {
      if (unlisten) unlisten();
    };
  }, [loadVideoByPath, setIsFullscreen]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      setVideoFile(file, url);
    }
  };

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
    <div 
      className={`h-screen flex flex-col bg-background text-foreground overflow-hidden selection:bg-indigo-500/30 ${isFullscreen ? 'fullscreen-active' : ''}`}
    >
      {/* Header */}
      {/* Header - hide in fullscreen to maximize space, or only show if NOT in fullscreen */}
      {!isFullscreen && (
      <header className="h-14 border-b border-border px-6 flex items-center justify-between bg-background/95 backdrop-blur-md z-10 shrink-0">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-black tracking-tighter bg-clip-text text-transparent bg-gradient-to-r from-blue-400 via-indigo-400 to-emerald-400 drop-shadow-sm">
            {t('app_name')}
          </h1>
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
          
          <AnimatePresence>
            {headerShowRes && (
              <motion.div
                key="res"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                layout
              >
                <Select 
                  value={resolution.name} 
                  onValueChange={(val) => setResolution(RESOLUTIONS.find(r => r.name === val)!)}
                >
                  <SelectTrigger className="w-[160px] bg-muted/50 border-border h-9 text-xs">
                    <SelectValue placeholder={t('resolution')} />
                  </SelectTrigger>
                  <SelectContent>
                    {RESOLUTIONS.map(r => (
                      <SelectItem key={r.name} value={r.name} className="text-xs">{r.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </motion.div>
            )}

            {headerShowTheme && (
              <motion.div
                key="theme"
                initial={{ opacity: 0, rotate: -15 }}
                animate={{ opacity: 1, rotate: 0 }}
                exit={{ opacity: 0, rotate: 15 }}
                layout
              >
                <ThemeToggle />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Keyboard Shortcuts Tooltip */}
          <AnimatePresence>
            {headerShowShortcuts && (
              <motion.div
                key="shortcuts"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                layout
              >
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger className="inline-flex items-center justify-center w-9 h-9 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                        <Keyboard className="w-4 h-4" />
                    </TooltipTrigger>
                    <TooltipContent side="bottom" align="end" className="max-w-xs bg-background/95 backdrop-blur-sm border border-border text-foreground shadow-2xl p-4">
                      <p className="font-semibold mb-3 text-indigo-400 flex items-center gap-2">
                        <Keyboard className="w-4 h-4" />
                        {t('keyboard_shortcuts')}
                      </p>
                      <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 text-[11px] text-muted-foreground items-center">
                        <kbd className="px-1.5 py-0.5 bg-muted border border-border rounded text-[9px] font-mono text-foreground uppercase shadow-sm">Space</kbd>
                        <span>{t('shortcut_play')}</span>
                        
                        <kbd className="px-1.5 py-0.5 bg-muted border border-border rounded text-[9px] font-mono text-foreground uppercase shadow-sm">J / L</kbd>
                        <span>{t('shortcut_back').split(' ')[0]} / {t('shortcut_forward').split(' ')[0]}</span>
                        
                        <kbd className="px-1.5 py-0.5 bg-muted border border-border rounded text-[9px] font-mono text-foreground uppercase shadow-sm">← / →</kbd>
                        <span>{t('shortcut_frame_back')} / {t('shortcut_frame_forward')}</span>
                        
                        <kbd className="px-1.5 py-0.5 bg-muted border border-border rounded text-[9px] font-mono text-foreground uppercase shadow-sm">+ / -</kbd>
                        <span>{t('zoom')} Canvas</span>
                        
                        <kbd className="px-1.5 py-0.5 bg-muted border border-border rounded text-[9px] font-mono text-foreground uppercase shadow-sm">Ctrl+Z</kbd>
                        <span>{t('shortcut_undo')}</span>
                        
                        <kbd className="px-1.5 py-0.5 bg-muted border border-border rounded text-[9px] font-mono text-foreground uppercase shadow-sm">Shift+Z</kbd>
                        <span>{t('shortcut_redo')}</span>
                      </div>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </motion.div>
            )}

            {headerShowTutorial && (
              <motion.div
                key="tutorial"
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
                layout
              >
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger 
                      onClick={() => window.open("/Tutorial_FG_Reproductor.pdf", "_blank")}
                      className="inline-flex items-center justify-center w-9 h-9 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                    >
                      <BookOpen className="w-4 h-4" />
                    </TooltipTrigger>
                    <TooltipContent side="bottom" align="end" className="bg-background/95 backdrop-blur-sm border border-border text-foreground shadow-2xl p-3">
                      <div className="flex flex-col gap-1">
                        <p className="font-bold text-indigo-400 flex items-center gap-2">
                          <BookOpen className="w-3.5 h-3.5" />
                          {t('tutorial')}
                        </p>
                        <p className="text-[10px] text-muted-foreground">Abrir guía en PDF interactivo</p>
                      </div>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </motion.div>
            )}
          </AnimatePresence>

          <motion.div layout>
            <ExportModal />
          </motion.div>
          
          <AnimatePresence>
            {headerShowLang && (
              <motion.div
                key="lang"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                layout
              >
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
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </header>
      )}

      {/* Main Editing Area */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Top: Video Preview Workspace */}
        <div className={`flex-1 bg-[#121212] flex flex-col relative w-full shadow-inner ${isFullscreen ? '' : 'border-b border-border'}`}>
          <Suspense fallback={<div className="flex-1 flex items-center justify-center text-muted-foreground animate-pulse">Cargando editor...</div>}>
            <Canvas />
          </Suspense>

          {/* Canvas Zoom Indicator */}
          {duration > 0 && !isFullscreen && (
            <div className="absolute bottom-3 left-3 z-20 bg-black/60 backdrop-blur-sm text-white text-[11px] font-mono px-2.5 py-1 rounded-md border border-white/10 select-none tabular-nums">
              {t('canvas_zoom')}: {(canvasScale * 100).toFixed(0)}%
            </div>
          )}
        </div>
        
        {/* Bottom Panel: Editing Tools */}
        {!isFullscreen && (
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
            {!showInspector && !isFullscreen && (
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
        )}
      </main>
    </div>
  );
}
