"use client";

import { useTimeline } from "@/hooks/useTimeline";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { RotateCcw, ChevronRight, Settings, MonitorPlay, Clapperboard, Sun, Moon, Monitor } from "lucide-react";
import React, { useState, useRef, useEffect } from "react";
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

export default function Inspector({ onClose }: { onClose?: () => void }) {
  const { t } = useTranslation();
  const { zoom, posX, posY, setZoom, setPosX, setPosY, resetTransform, isPlayerMode, setPlayerMode } = useTimeline();
  const { theme, setTheme } = useTheme();
  const [showSettings, setShowSettings] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

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

  // Read default mode from localStorage
  const getDefaultMode = (): 'editor' | 'player' => {
    if (typeof window === 'undefined') return 'editor';
    return localStorage.getItem('defaultMode') === 'player' ? 'player' : 'editor';
  };

  const setDefaultMode = (mode: 'editor' | 'player') => {
    localStorage.setItem('defaultMode', mode);
    // Also apply the mode immediately
    setPlayerMode(mode === 'player');
  };

  const [defaultMode, setDefaultModeState] = useState<'editor' | 'player'>(getDefaultMode);

  const handleSetDefaultMode = (mode: 'editor' | 'player') => {
    setDefaultModeState(mode);
    setDefaultMode(mode);
  };

  return (
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

          <Button variant="ghost" size="icon" onClick={resetTransform} title={t('reset_all')} className="rounded-full w-8 h-8">
            <RotateCcw className="w-4 h-4" />
          </Button>

          {onClose && (
            <Button variant="ghost" size="icon" onClick={onClose} title="Hide Inspector" className="rounded-full w-8 h-8 text-muted-foreground">
              <ChevronRight className="w-5 h-5 shadow-sm" />
            </Button>
          )}
        </div>

        {/* Floating Settings Popover */}
        <AnimatePresence>
          {showSettings && (
            <motion.div
              ref={popoverRef}
              initial={{ opacity: 0, y: -8, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.95 }}
              transition={{ type: "spring", bounce: 0.15, duration: 0.3 }}
              className="absolute top-full right-0 mt-2 z-[100] w-72 bg-background border border-border rounded-xl shadow-2xl shadow-black/40 overflow-hidden"
              style={{ backdropFilter: 'blur(20px)' }}
            >
              {/* Header */}
              <div className="px-4 py-3 border-b border-border/50 bg-muted/30">
                <div className="flex items-center gap-2">
                  <Settings className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{t('settings')}</span>
                </div>
              </div>

              <div className="p-4 space-y-5">
                {/* Default Mode */}
                <div className="space-y-2.5">
                  <span className="text-sm font-medium text-foreground">{t('default_mode')}</span>
                  <p className="text-[11px] text-muted-foreground leading-tight">
                    Al abrir el programa o un video, se iniciará en este modo.
                  </p>
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <button
                      onClick={() => handleSetDefaultMode('editor')}
                      className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition-all ${
                        defaultMode === 'editor'
                          ? 'bg-indigo-500/15 border-indigo-500/40 text-indigo-400 shadow-sm shadow-indigo-500/10'
                          : 'bg-muted/30 border-border/50 text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                      }`}
                    >
                      <Clapperboard className="w-4 h-4 shrink-0" />
                      {t('editor_mode')}
                    </button>
                    <button
                      onClick={() => handleSetDefaultMode('player')}
                      className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition-all ${
                        defaultMode === 'player'
                          ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400 shadow-sm shadow-emerald-500/10'
                          : 'bg-muted/30 border-border/50 text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                      }`}
                    >
                      <MonitorPlay className="w-4 h-4 shrink-0" />
                      {t('player_mode')}
                    </button>
                  </div>
                </div>

                {/* Divider */}
                <div className="border-t border-border/50" />

                {/* Theme */}
                <div className="space-y-2.5">
                  <span className="text-sm font-medium text-foreground">{t('theme')}</span>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      onClick={() => setTheme('dark')}
                      className={`flex flex-col items-center gap-1.5 px-2 py-2.5 rounded-lg border text-[11px] font-medium transition-all ${
                        theme === 'dark'
                          ? 'bg-indigo-500/15 border-indigo-500/40 text-indigo-400 shadow-sm shadow-indigo-500/10'
                          : 'bg-muted/30 border-border/50 text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                      }`}
                    >
                      <Moon className="w-4 h-4" />
                      {t('theme_dark')}
                    </button>
                    <button
                      onClick={() => setTheme('light')}
                      className={`flex flex-col items-center gap-1.5 px-2 py-2.5 rounded-lg border text-[11px] font-medium transition-all ${
                        theme === 'light'
                          ? 'bg-amber-500/15 border-amber-500/40 text-amber-400 shadow-sm shadow-amber-500/10'
                          : 'bg-muted/30 border-border/50 text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                      }`}
                    >
                      <Sun className="w-4 h-4" />
                      {t('theme_light')}
                    </button>
                    <button
                      onClick={() => setTheme('system')}
                      className={`flex flex-col items-center gap-1.5 px-2 py-2.5 rounded-lg border text-[11px] font-medium transition-all ${
                        theme === 'system'
                          ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-400 shadow-sm shadow-cyan-500/10'
                          : 'bg-muted/30 border-border/50 text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                      }`}
                    >
                      <Monitor className="w-4 h-4" />
                      {t('theme_system')}
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

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
  );
}
