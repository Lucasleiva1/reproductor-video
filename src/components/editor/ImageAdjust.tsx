import { memo, useEffect, useRef, useState } from "react";
import type { ColorCorrection } from "@/hooks/useTimeline";
import { applyColorPreview } from "@/utils/colorPreview";

/** Tone overlays for the image adjustments; their strength comes from the --cc-* CSS variables. */
export function ColorOverlays({ show }: { show: boolean }) {
  if (!show) return null;
  const layer = (background: string, mixBlendMode: React.CSSProperties["mixBlendMode"], opacity: string) => (
    <div className="absolute inset-0" style={{ background, mixBlendMode, opacity }} />
  );
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {layer("rgba(255,255,255,1)", "screen", "var(--cc-shadow-lift, 0)")}
      {layer("rgba(0,0,0,1)", "multiply", "var(--cc-shadow-crush, 0)")}
      {layer("rgba(255,255,255,1)", "soft-light", "var(--cc-highlight-lift, 0)")}
      {layer("rgba(0,0,0,1)", "soft-light", "var(--cc-highlight-recover, 0)")}
      {layer("var(--cc-temperature-color, transparent)", "soft-light", "var(--cc-temperature-opacity, 0)")}
    </div>
  );
}

const SLIDERS = [
  ["Brillo", "brightness"],
  ["Luces", "highlights"],
  ["Sombras", "shadows"],
  ["Contraste", "contrast"],
  ["Saturacion", "saturation"],
  ["Temperatura", "temperature"],
] as const;

type SliderKey = (typeof SLIDERS)[number][1];

interface ColorSlidersProps {
  value: ColorCorrection;
  getPreviewTarget: () => HTMLElement | null;
  onCommit: (updates: Partial<ColorCorrection>) => void;
}

/**
 * Image sliders that stay smooth while dragging: the preview is written straight to the video's
 * CSS variables and only this small component re-renders. The app state (and with it the whole
 * player) is updated once, when the slider is released.
 */
export const ColorSliders = memo(function ColorSliders({ value, getPreviewTarget, onCommit }: ColorSlidersProps) {
  const [draft, setDraft] = useState(value);
  const draftRef = useRef(value);
  const dirtyRef = useRef(false);
  const draggingRef = useRef(false);
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  // Outside a drag the sliders always follow the app (presets, reset, undo…).
  useEffect(() => {
    if (draggingRef.current) return;
    dirtyRef.current = false;
    draftRef.current = value;
    setDraft(value);
  }, [value]);

  // The pointer is often released outside the slider; without this the drag would never end
  // and the sliders would stop following the app.
  useEffect(() => {
    const stop = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      commit();
    };
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const commit = () => {
    if (!dirtyRef.current) return;
    dirtyRef.current = false;
    const d = draftRef.current;
    onCommitRef.current({
      brightness: d.brightness,
      highlights: d.highlights,
      shadows: d.shadows,
      contrast: d.contrast,
      saturation: d.saturation,
      temperature: d.temperature,
    });
  };

  // Closing the panel in the middle of a drag must not lose the change.
  useEffect(() => () => commit(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const update = (key: SliderKey, amount: number) => {
    const next = { ...draftRef.current, enabled: true, [key]: amount };
    draftRef.current = next;
    dirtyRef.current = true;
    setDraft(next);
    applyColorPreview(getPreviewTarget(), next, true);
  };

  return (
    <>
      {SLIDERS.map(([label, key]) => (
        <label key={key} className="block mb-3">
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="text-white/75">{label}</span>
            <span className="font-mono text-white/50">{draft[key].toFixed(0)}</span>
          </div>
          <input
            type="range"
            min={-50}
            max={50}
            step={1}
            value={draft[key]}
            onChange={(e) => update(key, Number(e.target.value))}
            onPointerDown={() => { draggingRef.current = true; }}
            onKeyUp={commit}
            onBlur={commit}
            className="w-full accent-blue-500"
          />
        </label>
      ))}
    </>
  );
});
