import { memo, useEffect, useRef, useState } from "react";
import type { ColorCorrection } from "@/hooks/useTimeline";

type SliderKey = "brightness" | "contrast" | "saturation" | "gamma" | "hue" | "temperature" | "shadows" | "highlights" | "sharpness";
type SliderSpec = { key: SliderKey; label: string; min: number; max: number };

/* Los mismos grupos y nombres que el panel Imagen de CINE WANA. */
const GROUPS: Array<{ title: string; sliders: SliderSpec[] }> = [
  {
    title: "Luz y color",
    sliders: [
      { key: "brightness", label: "Brillo", min: -50, max: 50 },
      { key: "contrast", label: "Contraste", min: -50, max: 50 },
      { key: "saturation", label: "Saturación", min: -50, max: 50 },
      { key: "gamma", label: "Gamma", min: -50, max: 50 },
      { key: "hue", label: "Tono del color", min: -50, max: 50 },
      { key: "temperature", label: "Temperatura", min: -50, max: 50 },
    ],
  },
  {
    title: "Sombreado",
    sliders: [
      { key: "shadows", label: "Sombras", min: -50, max: 50 },
      { key: "highlights", label: "Luces", min: -50, max: 50 },
    ],
  },
  {
    title: "Detalle",
    sliders: [{ key: "sharpness", label: "Nitidez", min: 0, max: 100 }],
  },
];

const ALL_KEYS = GROUPS.flatMap((group) => group.sliders.map((slider) => slider.key));

interface ColorSlidersProps {
  value: ColorCorrection;
  /** Se llama en cada movimiento: el reproductor mpv muestra el cambio al instante. */
  onPreview: (next: ColorCorrection) => void;
  onCommit: (updates: Partial<ColorCorrection>) => void;
}

/**
 * Controles de imagen que no traban la reproducción: mientras se arrastra solo se re-dibuja este
 * componente y se le avisa a mpv; el estado de la app se actualiza una vez, al soltar.
 */
export const ColorSliders = memo(function ColorSliders({ value, onPreview, onCommit }: ColorSlidersProps) {
  const [draft, setDraft] = useState(value);
  const draftRef = useRef(value);
  const dirtyRef = useRef(false);
  const draggingRef = useRef(false);
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  // Fuera de un arrastre los controles siguen siempre a la app (ajustes rápidos, reset…).
  useEffect(() => {
    if (draggingRef.current) return;
    dirtyRef.current = false;
    draftRef.current = value;
    setDraft(value);
  }, [value]);

  // El mouse muchas veces se suelta fuera del control; sin esto el arrastre no terminaría nunca.
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
    const updates: Partial<ColorCorrection> = {};
    for (const key of ALL_KEYS) updates[key] = d[key];
    onCommitRef.current(updates);
  };

  // Cerrar el panel en medio de un arrastre no tiene que perder el cambio.
  useEffect(() => () => commit(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const update = (key: SliderKey, amount: number) => {
    const next = { ...draftRef.current, enabled: true, [key]: amount };
    draftRef.current = next;
    dirtyRef.current = true;
    setDraft(next);
    onPreview(next);
  };

  return (
    <>
      {GROUPS.map((group) => (
        <div key={group.title} className="mb-1">
          <div className="mb-2 mt-1 text-[10px] font-semibold uppercase tracking-wider text-white/40">{group.title}</div>
          {group.sliders.map(({ key, label, min, max }) => (
            <label key={key} className="block mb-3">
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="text-white/75">{label}</span>
                <span className="font-mono text-white/50">{(draft[key] ?? 0).toFixed(0)}</span>
              </div>
              <input
                type="range"
                min={min}
                max={max}
                step={1}
                value={draft[key] ?? 0}
                onChange={(e) => update(key, Number(e.target.value))}
                onPointerDown={() => { draggingRef.current = true; }}
                onDoubleClick={() => { update(key, 0); commit(); }}
                onKeyUp={commit}
                onBlur={commit}
                title="Doble clic para volver a 0"
                className="w-full accent-blue-500"
              />
            </label>
          ))}
        </div>
      ))}
    </>
  );
});
