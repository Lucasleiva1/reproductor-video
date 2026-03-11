"use client";

import Canvas from "@/components/editor/Canvas";
import Timeline from "@/components/editor/Timeline";
import Inspector from "@/components/editor/Inspector";
import ExportModal from "@/components/ui/ExportModal";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { useTimeline } from "@/hooks/useTimeline";
import { Button } from "@/components/ui/button";
import { Upload } from "lucide-react";

export default function Home() {
  const { setVideoFile } = useTimeline();

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      setVideoFile(file, url);
    }
  };

  return (
    <div className="h-screen flex flex-col bg-background text-foreground overflow-hidden">
      {/* Header */}
      <header className="h-14 border-b border-border px-6 flex items-center justify-between bg-background/95 backdrop-blur-md z-10 shrink-0">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-emerald-400">
            FG Reproductor
          </h1>
          <span className="text-xs font-mono text-muted-foreground border border-border px-2 py-0.5 rounded-full">v1.0.0</span>
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
              Change Video
            </Button>
          </div>
          <ThemeToggle />
          <ExportModal />
        </div>
      </header>

      {/* Main Editing Area */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Top: Video Preview */}
        <div className="flex-1 bg-black flex flex-col relative w-full border-b border-border shadow-inner">
          <Canvas />
        </div>
        
        {/* Bottom Panel: Editing Tools */}
        <div className="h-[22rem] bg-background flex shrink-0 w-full z-10">
          <div className="flex-1 flex flex-col h-full border-r border-border overflow-hidden">
             <Timeline />
          </div>
          <div className="w-[400px] shrink-0 h-full overflow-y-auto bg-muted/10">
             <Inspector />
          </div>
        </div>
      </main>
    </div>
  );
}
