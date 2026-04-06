
import { useTimeline, RESOLUTIONS } from "@/hooks/useTimeline";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { RotateCcw, ChevronRight, ChevronLeft, Settings, Sun, Moon, Monitor, Eye, Globe, Ratio, Keyboard, Palette, BookOpen, Undo2, Redo2, Play, SkipBack, SkipForward, ZoomIn, Scissors, Lightbulb } from "lucide-react";
import React, { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useTheme } from "next-themes";
import { motion, AnimatePresence } from "framer-motion";

const ScrubbableNumber = ({ value, onChange, min, max, step = 1, format = (v: number) => v.toString() }: any) => {
  const handlePointerDown = (e: React.PointerEvent<HTMLSpanElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.dataset.startX = e.pageX.toString();
    e.currentTarget.dataset.startVal = value.toString();
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLSpanElement>) => {
    if (e.buttons === 1 && e.currentTarget.hasPointerCapture(e.pointerId)) {
      const startX = parseFloat(e.currentTarget.dataset.startX!);
      const startVal = parseFloat(e.currentTarget.dataset.startVal!);
      const delta = (e.pageX - startX) * 0.5;
      
      let newValue = startVal + delta * step;
      newValue = Math.max(min, Math.min(max, newValue));
      onChange(newValue);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLSpanElement>) => {
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch(err) {}
  };

  return (
    <span 
      className="text-xs text-muted-foreground w-12 text-right cursor-ew-resize hover:text-foreground select-none tabular-nums"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      title="Drag left/right to adjust"
    >
      {format(value)}
    </span>
  );
};

// Toggle switch component
const ToggleSwitch = ({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) => (
  <button
    onClick={() => onChange(!checked)}
    className={`relative w-9 h-5 rounded-full transition-colors duration-200 ${checked ? 'bg-indigo-500' : 'bg-zinc-600'}`}
  >
    <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200 ${checked ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
  </button>
);

export default function Inspector({ onClose }: { onClose?: () => void }) {
  const { t, i18n } = useTranslation();
  const { 
    zoom, posX, posY, setZoom, setPosX, setPosY, resetTransform, 
    resolution, setResolution,
    headerShowLang, headerShowRes, headerShowShortcuts, headerShowTheme, headerShowTutorial,
    setHeaderShowLang, setHeaderShowRes, setHeaderShowShortcuts, setHeaderShowTheme, setHeaderShowTutorial,
    undo, redo, past, future, saveHistory,
    bladeModeLimit, setBladeModeLimit,
    timelineTimeMode, setTimelineTimeMode,
    showTips, setShowTips
  } = useTimeline();
  const { theme, setTheme } = useTheme();
  const [showSettings, setShowSettings] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [popoverPos, setPopoverPos] = useState({ top: 0, left: 0 });

  const [devLinkIndex, setDevLinkIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setDevLinkIndex((prev) => (prev + 1) % 2);
    }, 60000); // 1 minute
    return () => clearInterval(interval);
  }, []);

  const devLinks = [
    { text: "POWERED BY FLOWGRAVITY", url: "https://my-portfolio-tau-mauve.vercel.app/" },
    { text: "BAJO FLOW", url: "https://bajo-flow.netlify.app/" }
  ];

  // Calculate popover position when opening
  useEffect(() => {
    if (showSettings && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      // Position to the left, and clamp so it doesn't go above the viewport
      const popoverHeight = 620; // approximate
      let top = rect.top;
      if (top + popoverHeight > window.innerHeight) {
        top = window.innerHeight - popoverHeight - 16;
      }
      top = Math.max(8, top);
      setPopoverPos({
        top,
        left: rect.left - 304 - 12, // 304 = w-76, 12 = gap
      });
    }
  }, [showSettings]);

  // Close popover when clicking outside
  useEffect(() => {
    if (!showSettings) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        popoverRef.current && !popoverRef.current.contains(e.target as Node) &&
        buttonRef.current && !buttonRef.current.contains(e.target as Node)
      ) {
        setShowSettings(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showSettings]);


  const languages = [
    { code: 'es', label: 'Español' },
    { code: 'en', label: 'English' },
    { code: 'pt', label: 'Português' },
  ];

  return (
    <>
    <div className="w-full h-full bg-background/95 backdrop-blur-sm p-6 flex flex-col gap-6">
      <div className="flex items-center pb-4 border-b border-border/50 relative">
        <h2 className="text-lg font-semibold tracking-tight tabular-nums flex-1">{t('inspector')}</h2>
        
        <div className="flex items-center gap-1">
          {/* Settings Gear Button */}
          <Button 
            ref={buttonRef}
            variant={showSettings ? "secondary" : "ghost"} 
            size="icon" 
            onClick={() => setShowSettings(!showSettings)} 
            title={t('settings')} 
            className={`rounded-full w-8 h-8 transition-all ${showSettings ? 'bg-indigo-500/20 text-indigo-400 hover:bg-indigo-500/30' : ''}`}
          >
            <Settings className={`w-4 h-4 transition-transform duration-500 ${showSettings ? 'rotate-90' : ''}`} />
          </Button>

          <Button 
            variant="ghost" 
            size="icon" 
            onClick={undo} 
            disabled={past.length === 0}
            title={t('shortcut_undo')} 
            className="rounded-full w-8 h-8 text-muted-foreground hover:text-foreground"
          >
            <Undo2 className="w-4 h-4" />
          </Button>

          <Button 
            variant="ghost" 
            size="icon" 
            onClick={redo} 
            disabled={future.length === 0}
            title={t('shortcut_redo')} 
            className="rounded-full w-8 h-8 text-muted-foreground hover:text-foreground"
          >
            <Redo2 className="w-4 h-4" />
          </Button>

          <Button variant="ghost" size="icon" onClick={() => { saveHistory(); resetTransform(); }} title={t('reset_all')} className="rounded-full w-8 h-8 text-muted-foreground hover:text-foreground">
            <RotateCcw className="w-4 h-4" />
          </Button>

          {onClose && (
            <Button variant="ghost" size="icon" onClick={onClose} title="Hide Inspector" className="rounded-full w-8 h-8 text-muted-foreground">
              <ChevronRight className="w-5 h-5 shadow-sm" />
            </Button>
          )}
        </div>
      </div>

      {/* Floating Settings Popover via Portal */}
      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {showSettings && (
            <motion.div
              ref={popoverRef}
              initial={{ opacity: 0, x: 10, scale: 0.95 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 10, scale: 0.95 }}
              transition={{ type: "spring", bounce: 0.15, duration: 0.3 }}
              className="fixed z-[9999] w-76 bg-background border border-border rounded-xl shadow-2xl shadow-black/40 overflow-hidden"
              style={{ top: popoverPos.top, left: popoverPos.left, width: 304, backdropFilter: 'blur(20px)', maxHeight: `calc(100vh - ${popoverPos.top + 16}px)`, overflowY: 'auto' }}
            >
              {/* Header */}
              <div className="px-4 py-3 border-b border-border/50 bg-background/95 backdrop-blur-md sticky top-0 z-10">
                <div className="flex items-center gap-2">
                  <Settings className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{t('settings')}</span>
                </div>
              </div>

              <div className="p-4 pb-8 space-y-5">

                {/* Theme */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Palette className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="text-sm font-medium text-foreground">{t('theme')}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { key: 'dark', icon: Moon, label: t('theme_dark'), active: 'bg-indigo-500/15 border-indigo-500/40 text-indigo-400' },
                      { key: 'light', icon: Sun, label: t('theme_light'), active: 'bg-amber-500/15 border-amber-500/40 text-amber-400' },
                      { key: 'system', icon: Monitor, label: t('theme_system'), active: 'bg-cyan-500/15 border-cyan-500/40 text-cyan-400' },
                    ].map(({ key, icon: Icon, label, active }) => (
                      <button
                        key={key}
                        onClick={() => setTheme(key)}
                        className={`flex flex-col items-center gap-1 px-2 py-2 rounded-lg border text-[11px] font-medium transition-all ${
                          theme === key ? active : 'bg-muted/30 border-border/50 text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                        }`}
                      >
                        <Icon className="w-3.5 h-3.5" />
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="border-t border-border/50" />

                {/* Language */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Globe className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="text-sm font-medium text-foreground">{t('language')}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {languages.map(lang => (
                      <button
                        key={lang.code}
                        onClick={() => i18n.changeLanguage(lang.code)}
                        className={`px-2 py-2 rounded-lg border text-[11px] font-medium transition-all text-center ${
                          i18n.resolvedLanguage === lang.code
                            ? 'bg-indigo-500/15 border-indigo-500/40 text-indigo-400'
                            : 'bg-muted/30 border-border/50 text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                        }`}
                      >
                        {lang.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="border-t border-border/50" />

                {/* Resolution */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Ratio className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="text-sm font-medium text-foreground">{t('resolution')}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {RESOLUTIONS.map(res => (
                      <button
                        key={res.name}
                        onClick={() => setResolution(res)}
                        className={`px-2 py-1.5 rounded-lg border text-[10px] font-medium transition-all text-center leading-tight ${
                          resolution.name === res.name
                            ? 'bg-indigo-500/15 border-indigo-500/40 text-indigo-400'
                            : 'bg-muted/30 border-border/50 text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                        }`}
                      >
                        {res.name}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="border-t border-border/50" />

                {/* Header Elements Visibility */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Eye className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="text-sm font-medium text-foreground">{t('header_elements')}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                    {[
                      { label: t('resolution'), checked: headerShowRes, onChange: setHeaderShowRes, icon: Ratio },
                      { label: t('theme'), checked: headerShowTheme, onChange: setHeaderShowTheme, icon: Palette },
                      { label: t('shortcuts'), checked: headerShowShortcuts, onChange: setHeaderShowShortcuts, icon: Keyboard },
                      { label: t('language'), checked: headerShowLang, onChange: setHeaderShowLang, icon: Globe },
                      { label: t('tutorial'), checked: headerShowTutorial, onChange: setHeaderShowTutorial, icon: BookOpen },
                      { label: t('show_tips'), checked: showTips, onChange: setShowTips, icon: Lightbulb },
                    ].map(({ label, checked, onChange, icon: Icon }) => (
                      <div key={label} className="flex flex-col gap-1.5">
                        <div className="flex items-center gap-1.5">
                          <Icon className="w-3 h-3 text-muted-foreground" />
                          <span className="text-[11px] text-foreground truncate">{label}</span>
                        </div>
                        <ToggleSwitch checked={checked} onChange={onChange} />
                      </div>
                    ))}
                  </div>
                </div>

                <div className="border-t border-border/50" />

                {/* Cut Mode */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Scissors className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="text-sm font-medium text-foreground">{t('cut_mode')}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { value: 1, label: t('cut_1'), active: 'bg-red-500/15 border-red-500/40 text-red-400' },
                      { value: 2, label: t('cut_2'), active: 'bg-indigo-500/15 border-indigo-500/40 text-indigo-400' },
                      { value: 0, label: t('cut_unlimited'), active: 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400' },
                    ].map(({ value, label, active }) => (
                      <button
                        key={value}
                        onClick={() => setBladeModeLimit(value)}
                        className={`flex flex-col items-center gap-1 px-2 py-2 rounded-lg border text-[11px] font-medium transition-all ${
                          bladeModeLimit === value ? active : 'bg-muted/30 border-border/50 text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                        }`}
                      >
                        {value === 0 ? '∞' : `✂️×${value}`}
                        <span className="text-[9px]">{label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="border-t border-border/50" />

                {/* Timeline Time Mode */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <BookOpen className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="text-sm font-medium text-foreground">{t('timeline_time_mode')}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {(['seconds', 'minutes', 'hidden'] as const).map((mode) => (
                      <button
                        key={mode}
                        onClick={() => setTimelineTimeMode(mode)}
                        className={`flex flex-col items-center gap-1 px-2 py-2 rounded-lg border text-[11px] font-medium transition-all ${
                          timelineTimeMode === mode 
                            ? 'bg-indigo-500/15 border-indigo-500/40 text-indigo-400' 
                            : 'bg-muted/30 border-border/50 text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                        }`}
                      >
                        {t(mode)}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="border-t border-border/50" />

                {/* Keyboard Shortcuts List */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Keyboard className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="text-sm font-medium text-foreground">{t('keyboard_shortcuts')}</span>
                  </div>
                  <div className="space-y-1.5">
                    {[
                      { icon: Play, keys: ["Space"], label: t('shortcut_play') },
                      { icon: SkipBack, keys: ["J"], label: t('shortcut_back').split(' ')[0] },
                      { icon: SkipForward, keys: ["L"], label: t('shortcut_forward').split(' ')[0] },
                      { icon: SkipBack, keys: ["←"], size: "icon-sm", label: t('shortcut_frame_back').split(' ')[0] },
                      { icon: SkipForward, keys: ["→"], size: "icon-sm", label: t('shortcut_frame_forward').split(' ')[0] },
                      { icon: ZoomIn, keys: ["+", "-"], label: t('zoom') + " Canvas" },
                      { icon: Undo2, keys: ["Ctrl+Z"], label: t('shortcut_undo') },
                      { icon: Redo2, keys: ["Shift+Z"], label: t('shortcut_redo') },
                    ].map((item, idx) => (
                      <div key={idx} className="flex items-center justify-between text-[10px] bg-muted/10 hover:bg-muted/20 p-1.5 rounded-md border border-border/20 transition-colors group">
                        <div className="flex items-center gap-2">
                          <item.icon className="w-3 h-3 text-muted-foreground group-hover:text-indigo-400 transition-colors" />
                          <span className="text-muted-foreground/80">{item.label}</span>
                        </div>
                        <div className="flex gap-1">
                          {item.keys.map(k => (
                            <span key={k} className="font-mono bg-background/50 px-1 rounded-sm border border-border/50 text-foreground/90 uppercase text-[9px]">
                              {k}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">{t('zoom')}</span>
          <ScrubbableNumber value={zoom} onChange={setZoom} min={10} max={500} step={1} format={(v: number) => `${(v/100).toFixed(1)}x`} />
        </div>
        <Slider value={[zoom]} min={10} max={500} onValueChange={(val) => setZoom(Array.isArray(val) ? val[0] : val as number)} />
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">{t('position_x')}</span>
          <ScrubbableNumber value={posX} onChange={setPosX} min={0} max={100} step={0.5} format={(v: number) => `${v.toFixed(0)}%`} />
        </div>
        <Slider value={[posX]} min={0} max={100} onValueChange={(val) => setPosX(Array.isArray(val) ? val[0] : val as number)} />
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">{t('position_y')}</span>
          <ScrubbableNumber value={posY} onChange={setPosY} min={0} max={100} step={0.5} format={(v: number) => `${v.toFixed(0)}%`} />
        </div>
        <Slider value={[posY]} min={0} max={100} onValueChange={(val) => setPosY(Array.isArray(val) ? val[0] : val as number)} />
      </div>

    </div>

    {/* Developer Attribution */}
    <div className="mt-8 pt-4 border-t flex flex-col items-center gap-3 pb-2">
      <div className="flex items-center gap-3 group/dev">
        {/* Manual Toggle Arrow (Left side) */}
        <button 
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setDevLinkIndex((prev) => (prev + 1) % 2);
          }}
          className="w-8 h-8 rounded-full bg-zinc-900 border border-white/10 flex items-center justify-center text-white/50 hover:text-white hover:bg-zinc-800 transition-all shadow-xl"
          title="Change brand"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        <div className="relative group">
          <AnimatePresence mode="wait">
            <motion.a 
              key={devLinkIndex}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
              href={devLinks[devLinkIndex].url}
              target="_blank"
              rel="noopener noreferrer"
              className="px-5 py-2.5 border border-border/50 rounded-full flex items-center justify-center gap-3 hover:bg-muted/50 transition-all group/link cursor-pointer shadow-sm hover:shadow-md bg-background/50"
              title="Visit Portfolio"
            >
              <Globe className="w-4 h-4 text-blue-500 group-hover/link:rotate-12 transition-transform" />
              <div className="flex flex-col min-w-[100px]">
                <span className="text-[9px] text-muted-foreground font-semibold uppercase leading-none tracking-[0.1em] mb-1">
                  {devLinkIndex === 0 ? "Powered By" : "Editor de video"}
                </span>
                <span className="text-xs font-black text-foreground leading-none tracking-wider">
                  {devLinkIndex === 0 ? "FLOWGRAVITY" : "BAJO FLOW"}
                </span>
              </div>
            </motion.a>
          </AnimatePresence>
        </div>
      </div>
    </div>
    </>
  );
}
