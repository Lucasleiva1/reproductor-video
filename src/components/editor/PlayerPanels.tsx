/* Paneles del reproductor mpv, iguales a los de CINE WANA: idioma y subtítulos, y los ajustes de
   imagen que solo cambian lo que se ve (no se exportan). */

import { AudioLines, Captions, Check } from "lucide-react";
import {
  ASPECT_CHOICES, DEFAULT_SUBTITLE_STYLE, ROTATE_CHOICES, SCALING_CHOICES, SUBTITLE_COLORS,
  SUBTITLE_FONTS, SUBTITLE_HEIGHT_MAX, TONE_MAPPING_CHOICES, VIEW_SWITCHES, formatDelay, mpvCommand,
  trackDetail, trackLabel, tracksOf, useMpv, type SubtitleStyle, type ViewSwitch,
} from "@/player/mpv";

const sectionTitle = "mb-2 mt-4 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/40";

function Choices<T extends string | number>({ label, choices, value, onChange }: {
  label: string;
  choices: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="mb-3">
      <div className="mb-1.5 text-xs text-white/75">{label}</div>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
        {choices.map((choice) => {
          const selected = choice.value === value;
          return (
            <button
              key={String(choice.value)}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(choice.value)}
              className={`rounded-md border px-2.5 py-1 text-[11px] transition-colors ${
                selected
                  ? "border-blue-400/60 bg-blue-500/20 text-blue-100"
                  : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white"
              }`}
            >
              {choice.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Switch({ name, value, onChange }: { name: ViewSwitch; value: boolean; onChange: (value: boolean) => void }) {
  const spec = VIEW_SWITCHES[name];
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      onClick={() => onChange(!value)}
      className="mb-2 flex w-full items-start gap-3 rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-left transition-colors hover:bg-white/[0.06]"
    >
      <span className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full border transition-colors ${value ? "border-blue-300/50 bg-blue-500" : "border-white/15 bg-white/10"}`}>
        <span className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${value ? "translate-x-4" : "translate-x-0"}`} />
      </span>
      <span className="min-w-0">
        <span className="block text-xs font-semibold text-white/85">{spec.label}</span>
        <span className="block text-[10px] leading-snug text-white/45">{spec.detail}</span>
      </span>
    </button>
  );
}

/** Ajustes de mpv que no son de color: agrandado, limpieza, movimiento, encuadre y HDR. */
export function ViewSettingsSection() {
  const view = useMpv((s) => s.view);
  const setView = useMpv((s) => s.setView);
  return (
    <div className="mt-2 border-t border-white/10 pt-1">
      <div className="mt-3 text-[11px] text-white/45">Estos ajustes cambian solo cómo lo ves; no van en la exportación.</div>

      <div className={sectionTitle}>Agrandado</div>
      <Choices label="Agrandado de la imagen" choices={SCALING_CHOICES} value={view.scaling} onChange={(scaling) => setView({ scaling })} />
      <Switch name="antiring" value={view.antiring} onChange={(antiring) => setView({ antiring })} />

      <div className={sectionTitle}>Limpieza</div>
      <Switch name="deband" value={view.deband} onChange={(deband) => setView({ deband })} />
      {view.deband && (
        <label className="block mb-3">
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="text-white/75">Intensidad</span>
            <span className="font-mono text-white/50">{view.debandStrength}</span>
          </div>
          <input type="range" min={0} max={100} step={1} value={view.debandStrength}
            onChange={(e) => setView({ debandStrength: Number(e.target.value) })} className="w-full accent-blue-500" />
        </label>
      )}
      <Switch name="deinterlace" value={view.deinterlace} onChange={(deinterlace) => setView({ deinterlace })} />

      <div className={sectionTitle}>Movimiento</div>
      <Switch name="smoothMotion" value={view.smoothMotion} onChange={(smoothMotion) => setView({ smoothMotion })} />

      <div className={sectionTitle}>Encuadre</div>
      <Switch name="fillScreen" value={view.fillScreen} onChange={(fillScreen) => setView({ fillScreen })} />
      <Choices label="Formato" choices={ASPECT_CHOICES} value={view.aspect} onChange={(aspect) => setView({ aspect })} />
      <Choices label="Girar" choices={ROTATE_CHOICES} value={view.rotate} onChange={(rotate) => setView({ rotate })} />

      <div className={sectionTitle}>Videos HDR</div>
      <Choices label="Pasar a tu pantalla" choices={TONE_MAPPING_CHOICES} value={view.toneMapping} onChange={(toneMapping) => setView({ toneMapping })} />
      <Switch name="hdrAutoPeak" value={view.hdrAutoPeak} onChange={(hdrAutoPeak) => setView({ hdrAutoPeak })} />
    </div>
  );
}

/** Idioma del audio y subtítulos: lo que trae el archivo, con el estilo de los subtítulos. */
export function TracksSection() {
  const engine = useMpv((s) => s.state);
  const audioTracks = tracksOf(engine, "audio");
  const subtitleTracks = tracksOf(engine, "sub");
  const activeSubtitle = subtitleTracks.find((track) => track.selected) ?? null;
  const subtitleStyle = engine?.subtitleStyle ?? DEFAULT_SUBTITLE_STYLE;

  const setSubtitleStyle = (change: Partial<SubtitleStyle>) => {
    const style: SubtitleStyle = { ...subtitleStyle, ...change };
    void mpvCommand({ type: "set_subtitle_style", style });
  };
  const setSubtitleDelay = (seconds: number) => {
    void mpvCommand({ type: "set_subtitle_delay", seconds: Math.round(seconds * 10) / 10 });
  };

  const trackButton = (key: string, selected: boolean, title: string, detail: string | null, onClick: () => void) => (
    <button
      key={key}
      type="button"
      onClick={onClick}
      className={`mb-1.5 flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left transition-colors ${
        selected ? "border-blue-400/60 bg-blue-500/15" : "border-white/10 bg-white/[0.03] hover:bg-white/[0.07]"
      }`}
    >
      <span className="min-w-0">
        <span className="block truncate text-xs font-semibold text-white/90">{title}</span>
        {detail && <span className="block truncate text-[10px] text-white/45">{detail}</span>}
      </span>
      {selected && <Check className="h-4 w-4 shrink-0 text-blue-300" />}
    </button>
  );

  return (
    <>
      <div className={sectionTitle} style={{ marginTop: 0 }}><AudioLines className="h-3.5 w-3.5" />Idioma del audio</div>
      {audioTracks.length === 0 && (
        <p className="mb-2 text-[11px] text-white/45">{engine?.loaded ? "Este archivo no trae audio." : "Leyendo las pistas del archivo…"}</p>
      )}
      {audioTracks.map((track, index) =>
        trackButton(`a-${track.id}`, track.selected, trackLabel(track, index + 1), trackDetail(track) || "Audio",
          () => void mpvCommand({ type: "set_audio_track", id: track.id })),
      )}

      <div className={sectionTitle}><Captions className="h-3.5 w-3.5" />Subtítulos</div>
      {trackButton("s-off", !activeSubtitle, "Sin subtítulos", null, () => void mpvCommand({ type: "set_subtitle_track", id: null }))}
      {subtitleTracks.map((track, index) =>
        trackButton(`s-${track.id}`, track.selected, trackLabel(track, index + 1), trackDetail(track) || "Subtítulo",
          () => void mpvCommand({ type: "set_subtitle_track", id: track.id })),
      )}
      {engine?.loaded && subtitleTracks.length === 0 && (
        <p className="mb-2 text-[11px] leading-snug text-white/45">
          Este archivo no trae subtítulos. Si ponés un archivo .srt con el mismo nombre al lado del video, aparece acá.
        </p>
      )}

      {activeSubtitle && (
        <div className="mt-3 rounded-md border border-white/10 bg-white/[0.03] p-3">
          <Choices label="Color" choices={SUBTITLE_COLORS} value={subtitleStyle.color} onChange={(color) => setSubtitleStyle({ color })} />
          <Choices label="Fuente" choices={SUBTITLE_FONTS} value={subtitleStyle.font} onChange={(font) => setSubtitleStyle({ font })} />
          <label className="block mb-3">
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="text-white/75">Altura</span>
              <span className="font-mono text-white/50">
                {100 - subtitleStyle.position === 0 ? "Abajo de todo" : `+${Math.round(100 - subtitleStyle.position)}`}
              </span>
            </div>
            <input
              type="range" min={0} max={SUBTITLE_HEIGHT_MAX} step={1} value={Math.round(100 - subtitleStyle.position)}
              onChange={(e) => setSubtitleStyle({ position: 100 - Number(e.target.value) })}
              onDoubleClick={() => setSubtitleStyle({ position: 100 })}
              title="Doble clic para volver abajo de todo"
              className="w-full accent-blue-500"
            />
          </label>
          <label className="block mb-3">
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="text-white/75">Tamaño</span>
              <span className="font-mono text-white/50">{Math.round((engine?.subtitleScale ?? 1) * 100)}%</span>
            </div>
            <input
              type="range" min={0.5} max={2} step={0.05} value={engine?.subtitleScale ?? 1}
              onChange={(e) => void mpvCommand({ type: "set_subtitle_scale", scale: Number(e.target.value) })}
              className="w-full accent-blue-500"
            />
          </label>
          <div className="text-xs text-white/75 flex items-center justify-between mb-1.5">
            <span>Sincronización</span>
            <span className="font-mono text-white/50">{formatDelay(engine?.subtitleDelay ?? 0)}</span>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <button type="button" onClick={() => setSubtitleDelay((engine?.subtitleDelay ?? 0) - 0.5)}
              className="rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-[11px] text-white/75 hover:bg-white/10 hover:text-white">
              Adelantar 0,5 s
            </button>
            <button type="button" onClick={() => setSubtitleDelay((engine?.subtitleDelay ?? 0) + 0.5)}
              className="rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-[11px] text-white/75 hover:bg-white/10 hover:text-white">
              Atrasar 0,5 s
            </button>
          </div>
          <p className="mt-1.5 text-[10px] leading-snug text-white/45">
            Si el texto aparece antes que la voz, tocá Atrasar. Si aparece después, Adelantar.
          </p>
          {Math.abs(engine?.subtitleDelay ?? 0) >= 0.05 && (
            <button type="button" onClick={() => setSubtitleDelay(0)} className="mt-1.5 text-[11px] text-blue-300 hover:text-blue-200">
              Volver a 0
            </button>
          )}
        </div>
      )}
    </>
  );
}
