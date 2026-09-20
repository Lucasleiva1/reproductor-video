import type { ColorCorrection } from "@/hooks/useTimeline";

// Live image-adjustment preview.
// The look is expressed as CSS custom properties on a container element: the video uses
// `filter: var(--cc-filter)` and the tone overlays read their opacity from variables. Sliders can
// then update the preview by writing the variables directly, without re-rendering React.

export const colorPreviewVars = (cc: ColorCorrection, active: boolean): Record<string, string> => {
  const on = active && cc.enabled;
  return {
    "--cc-filter": on
      ? `brightness(${1 + cc.brightness / 100}) contrast(${1 + cc.contrast / 100}) saturate(${1 + cc.saturation / 100})`
      : "none",
    "--cc-shadow-lift": String(on && cc.shadows > 0 ? Math.min(cc.shadows / 120, 0.42) : 0),
    "--cc-shadow-crush": String(on && cc.shadows < 0 ? Math.min(Math.abs(cc.shadows) / 140, 0.36) : 0),
    "--cc-highlight-lift": String(on && cc.highlights > 0 ? Math.min(cc.highlights / 155, 0.34) : 0),
    "--cc-highlight-recover": String(on && cc.highlights < 0 ? Math.min(Math.abs(cc.highlights) / 180, 0.28) : 0),
    "--cc-temperature-opacity": String(on ? Math.min(Math.abs(cc.temperature) / 120, 0.36) : 0),
    "--cc-temperature-color": cc.temperature >= 0 ? "rgba(255, 170, 85, 1)" : "rgba(95, 150, 255, 1)",
  };
};

export const applyColorPreview = (el: HTMLElement | null, cc: ColorCorrection, active: boolean) => {
  if (!el) return;
  const vars = colorPreviewVars(cc, active);
  for (const name in vars) el.style.setProperty(name, vars[name]);
};
