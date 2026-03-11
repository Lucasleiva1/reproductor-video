"use client";

import { useTimeline } from "@/hooks/useTimeline";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { RotateCcw } from "lucide-react";
import React from "react";

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
      // Control precision and sensitivity
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

export default function Inspector() {
  const { zoom, posX, posY, setZoom, setPosX, setPosY, resetTransform } = useTimeline();

  return (
    <div className="w-full h-full bg-background/95 backdrop-blur-sm p-6 flex flex-col gap-6">
      <div className="flex items-center justify-between pb-4 border-b border-border/50">
        <h2 className="text-lg font-semibold tracking-tight">Inspector</h2>
        <Button variant="ghost" size="icon" onClick={resetTransform} title="Reset All">
          <RotateCcw className="w-4 h-4" />
        </Button>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Zoom</span>
          <ScrubbableNumber value={zoom} onChange={setZoom} min={10} max={500} step={1} format={(v: number) => `${(v/100).toFixed(1)}x`} />
        </div>
        <Slider value={[zoom]} min={10} max={500} onValueChange={(val) => setZoom(Array.isArray(val) ? val[0] : val as number)} />
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Position X</span>
          <ScrubbableNumber value={posX} onChange={setPosX} min={0} max={100} step={0.5} format={(v: number) => `${v.toFixed(0)}%`} />
        </div>
        <Slider value={[posX]} min={0} max={100} onValueChange={(val) => setPosX(Array.isArray(val) ? val[0] : val as number)} />
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Position Y</span>
          <ScrubbableNumber value={posY} onChange={setPosY} min={0} max={100} step={0.5} format={(v: number) => `${v.toFixed(0)}%`} />
        </div>
        <Slider value={[posY]} min={0} max={100} onValueChange={(val) => setPosY(Array.isArray(val) ? val[0] : val as number)} />
      </div>

      <div className="text-xs text-muted-foreground bg-muted p-3 rounded-md mt-auto leading-relaxed">
        <p><strong>Note:</strong> Changes apply only visually overlayed on the proxy canvas.</p>
        <p className="mt-2">Rendering applies transformations natively via FFmpeg.</p>
      </div>
    </div>
  );
}
