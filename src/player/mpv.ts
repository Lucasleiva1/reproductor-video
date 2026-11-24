/* Puente con el reproductor mpv (libmpv dentro de la ventana de Flowuana, igual que en CINE WANA).
   La reproducción la hace mpv en Rust; acá se le mandan órdenes y se escucha lo que avisa. */

import { create } from "zustand";
import type { ColorCorrection } from "@/hooks/useTimeline";

export interface MpvTrack {
  id: number;
  kind: "video" | "audio" | "sub" | string;
  language?: string | null;
  title?: string | null;
  codec?: string | null;
  channels?: number | null;
  external: boolean;
  selected: boolean;
  defaultTrack: boolean;
  forced: boolean;
  hearingImpaired: boolean;
}

export type SubtitleColor = "blanco" | "amarillo";
export type SubtitleFont = "clasica" | "montserrat" | "segoe" | "verdana";
/* position: 100 es abajo de todo; cuanto menor, más arriba (en % de la pantalla). */
export interface SubtitleStyle { color: SubtitleColor; font: SubtitleFont; position: number }
export const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = { color: "blanco", font: "clasica", position: 100 };
export const SUBTITLE_COLORS: Array<{ value: SubtitleColor; label: string }> = [
  { value: "blanco", label: "Blanco" }, { value: "amarillo", label: "Amarillo" },
];
export const SUBTITLE_FONTS: Array<{ value: SubtitleFont; label: string }> = [
  { value: "clasica", label: "Clásica" }, { value: "montserrat", label: "Montserrat" },
  { value: "segoe", label: "Segoe UI" }, { value: "verdana", label: "Verdana" },
];
export const SUBTITLE_HEIGHT_MAX = 60;

export interface MpvState {
  session: number;
  loaded: boolean;
  videoReady: boolean;
  position: number;
  duration: number;
  paused: boolean;
  ended: boolean;
  buffering: boolean;
  volume: number;
  muted: boolean;
  speed: number;
  videoWidth: number;
  videoHeight: number;
  audioId?: number | null;
  subtitleId?: number | null;
  subtitleScale: number;
  subtitleDelay: number;
  subtitleStyle: SubtitleStyle;
  hardwareDecoder?: string | null;
  tracks: MpvTrack[];
  error?: string | null;
}

/* ----------------------------------------------------------------------------------------------
   Ajustes de imagen que solo cambian lo que se ve (no se exportan): los mismos de CINE WANA.
   ---------------------------------------------------------------------------------------------- */

export type MpvScaling = "normal" | "alta" | "suave";
export type MpvAspect = "original" | "16:9" | "4:3" | "2.35:1" | "1.85:1";
export type MpvToneMapping = "auto" | "bt.2390" | "hable" | "mobius";

export interface ViewSettings {
  scaling: MpvScaling;
  antiring: boolean;
  deband: boolean;
  debandStrength: number;
  deinterlace: boolean;
  smoothMotion: boolean;
  fillScreen: boolean;
  aspect: MpvAspect;
  rotate: number;
  toneMapping: MpvToneMapping;
  hdrAutoPeak: boolean;
}

export const DEFAULT_VIEW: ViewSettings = {
  scaling: "normal", antiring: false, deband: false, debandStrength: 35, deinterlace: false,
  smoothMotion: false, fillScreen: false, aspect: "original", rotate: 0, toneMapping: "auto", hdrAutoPeak: true,
};

export type ViewSwitch = "antiring" | "deband" | "deinterlace" | "smoothMotion" | "fillScreen" | "hdrAutoPeak";

export const VIEW_SWITCHES: Record<ViewSwitch, { label: string; detail: string }> = {
  antiring: { label: "Reducir halos", detail: "Quita el borde claro que aparece alrededor de las figuras al agrandar la imagen." },
  deband: { label: "Quitar bandas", detail: "Suaviza los escalones de color en cielos, sombras y paredes lisas." },
  deinterlace: { label: "Desentrelazar", detail: "Para grabaciones de TV o DVD que se ven con rayitas horizontales al moverse." },
  smoothMotion: { label: "Movimiento suave", detail: "Menos saltitos en los paneos de cámara. Usa más la placa de video." },
  fillScreen: { label: "Llenar la pantalla", detail: "Quita las franjas negras recortando un poco los bordes." },
  hdrAutoPeak: { label: "Brillo automático por escena", detail: "Para videos HDR: mide cada escena para que lo muy brillante no se queme." },
};

export const SCALING_CHOICES: Array<{ value: MpvScaling; label: string }> = [
  { value: "normal", label: "Normal" }, { value: "alta", label: "Alta calidad" }, { value: "suave", label: "Suave" },
];
export const ASPECT_CHOICES: Array<{ value: MpvAspect; label: string }> = [
  { value: "original", label: "Original" }, { value: "16:9", label: "16:9" }, { value: "4:3", label: "4:3" },
  { value: "2.35:1", label: "2.35:1" }, { value: "1.85:1", label: "1.85:1" },
];
export const ROTATE_CHOICES: Array<{ value: number; label: string }> = [
  { value: 0, label: "0°" }, { value: 90, label: "90°" }, { value: 180, label: "180°" }, { value: 270, label: "270°" },
];
export const TONE_MAPPING_CHOICES: Array<{ value: MpvToneMapping; label: string }> = [
  { value: "auto", label: "Automática" }, { value: "bt.2390", label: "Natural" }, { value: "hable", label: "Cine" }, { value: "mobius", label: "Suave" },
];

const VIEW_STORAGE_KEY = "flowuanaMpvView";

const loadView = (): ViewSettings => {
  try {
    const saved = JSON.parse(localStorage.getItem(VIEW_STORAGE_KEY) ?? "null");
    if (saved && typeof saved === "object") return { ...DEFAULT_VIEW, ...saved };
  } catch {}
  return DEFAULT_VIEW;
};

/** Lo que mpv recibe como ajuste de imagen: los colores (que también se exportan) más la vista. */
export const buildMpvImage = (color: ColorCorrection, showColor: boolean, view: ViewSettings) => {
  const on = showColor && color.enabled;
  const value = (amount: number) => (on ? amount : 0);
  return {
    brightness: value(color.brightness),
    contrast: value(color.contrast),
    saturation: value(color.saturation),
    gamma: value(color.gamma),
    hue: value(color.hue),
    shadows: value(color.shadows),
    highlights: value(color.highlights),
    temperature: value(color.temperature),
    sharpness: value(color.sharpness),
    ...view,
  };
};

/* ----------------------------------------------------------------------------------------------
   Estado compartido
   ---------------------------------------------------------------------------------------------- */

interface MpvStore {
  /** null = todavía no se sabe si libmpv arranca en esta computadora. */
  available: boolean | null;
  unavailableReason: string | null;
  state: MpvState | null;
  /** Momento (performance.now) en que llegó la última posición: sirve para estimar la actual. */
  receivedAt: number;
  /** Sesión del video que abrió la interfaz: se ignoran avisos de videos anteriores. */
  session: number;
  view: ViewSettings;
  setView: (change: Partial<ViewSettings>) => void;
}

export const useMpv = create<MpvStore>((set, get) => ({
  available: null,
  unavailableReason: null,
  state: null,
  receivedAt: 0,
  session: 0,
  view: typeof window !== "undefined" ? loadView() : DEFAULT_VIEW,
  setView: (change) => {
    const view = { ...get().view, ...change };
    try { localStorage.setItem(VIEW_STORAGE_KEY, JSON.stringify(view)); } catch {}
    set({ view });
  },
}));

export const hasTauri = () =>
  typeof (window as Window & { __TAURI_IPC__?: unknown }).__TAURI_IPC__ === "function";

const tauri = () => import("@tauri-apps/api/tauri");

let listening: Promise<void> | null = null;

/** Empieza a escuchar a mpv (una sola vez) y averigua si libmpv funciona en esta computadora. */
export const startMpv = () => {
  if (listening || !hasTauri()) return listening;
  listening = (async () => {
    const { listen } = await import("@tauri-apps/api/event");
    await listen<MpvState>("mpv-state", (event) => {
      const next = event.payload;
      if (next.session < useMpv.getState().session) return;
      useMpv.setState({ state: next, receivedAt: performance.now() });
    });
    try {
      const { invoke } = await tauri();
      const status = await invoke<{ available: boolean; message?: string | null }>("mpv_status");
      useMpv.setState({ available: status.available, unavailableReason: status.message ?? null });
    } catch (error) {
      useMpv.setState({ available: false, unavailableReason: String(error) });
    }
  })();
  return listening;
};

export interface OpenOptions {
  path: string;
  startSeconds: number;
  paused: boolean;
  volume: number;
  muted: boolean;
  image: ReturnType<typeof buildMpvImage>;
}

export const mpvOpen = async (options: OpenOptions) => {
  const { invoke } = await tauri();
  // Hasta que mpv conteste, la posición es la pedida.
  useMpv.setState({ state: null, receivedAt: performance.now() });
  const session = await invoke<number>("mpv_open", { ...options });
  useMpv.setState({ session });
  return session;
};

export const mpvStop = async () => {
  const { invoke } = await tauri();
  await invoke("mpv_stop").catch(() => {});
  useMpv.setState({ state: null });
};

export const mpvCommand = async (command: Record<string, unknown> & { type: string }) => {
  if (!useMpv.getState().available) return;
  const { invoke } = await tauri();
  try {
    await invoke("mpv_command", { command });
  } catch (error) {
    console.warn("mpv rechazó la orden", command.type, error);
  }
};

export const mpvScreenshot = async (filename: string) => {
  const { invoke } = await tauri();
  return invoke<string>("mpv_screenshot", { filename });
};

let seekBusy = false;
let seekNext: { seconds: number; fast: boolean } | null = null;

/** Pide un salto y deja la posición estimada en el destino hasta que mpv confirme. Si llegan
    muchos saltos seguidos (arrastrando la línea de tiempo), se manda solo el último. */
export const mpvSeek = (seconds: number, fast = false) => {
  const store = useMpv.getState();
  if (store.state) {
    useMpv.setState({ state: { ...store.state, position: seconds }, receivedAt: performance.now() });
  }
  if (seekBusy) {
    seekNext = { seconds, fast };
    return;
  }
  seekBusy = true;
  void (async () => {
    let next: { seconds: number; fast: boolean } | null = { seconds, fast };
    while (next) {
      await mpvCommand({ type: "seek_to", seconds: next.seconds, fast: next.fast });
      next = seekNext;
      seekNext = null;
    }
    seekBusy = false;
  })();
};

/** Posición actual estimada: la última que avisó mpv más lo que pasó desde entonces si está andando. */
export const mpvEstimatedPosition = () => {
  const { state, receivedAt } = useMpv.getState();
  if (!state) return null;
  if (state.paused || state.buffering || !state.loaded) return state.position;
  const elapsed = Math.min(0.5, (performance.now() - receivedAt) / 1000) * (state.speed || 1);
  return state.position + elapsed;
};

/* ----------------------------------------------------------------------------------------------
   Nombres en castellano para las pistas de audio y subtítulos (los mismos de CINE WANA)
   ---------------------------------------------------------------------------------------------- */

const LANGUAGE_NAMES: Record<string, string> = {
  spa: 'Español', es: 'Español', esp: 'Español', 'es-es': 'Español de España', 'es-mx': 'Español de México',
  lat: 'Español latino', 'es-419': 'Español latino', 'es-la': 'Español latino', 'es-us': 'Español latino',
  eng: 'Inglés', en: 'Inglés', 'en-us': 'Inglés', 'en-gb': 'Inglés británico',
  por: 'Portugués', pt: 'Portugués', 'pt-br': 'Portugués de Brasil', 'pt-pt': 'Portugués de Portugal',
  fre: 'Francés', fra: 'Francés', fr: 'Francés', ita: 'Italiano', it: 'Italiano',
  ger: 'Alemán', deu: 'Alemán', de: 'Alemán', jpn: 'Japonés', ja: 'Japonés', kor: 'Coreano', ko: 'Coreano',
  chi: 'Chino', zho: 'Chino', zh: 'Chino', rus: 'Ruso', ru: 'Ruso', cat: 'Catalán', ca: 'Catalán',
  glg: 'Gallego', gl: 'Gallego', eus: 'Euskera', baq: 'Euskera', ara: 'Árabe', ar: 'Árabe', hin: 'Hindi', hi: 'Hindi',
  tur: 'Turco', tr: 'Turco', pol: 'Polaco', pl: 'Polaco', dut: 'Neerlandés', nld: 'Neerlandés', nl: 'Neerlandés',
  swe: 'Sueco', sv: 'Sueco', nor: 'Noruego', nob: 'Noruego', no: 'Noruego', dan: 'Danés', da: 'Danés',
  fin: 'Finlandés', fi: 'Finlandés', gre: 'Griego', ell: 'Griego', el: 'Griego', heb: 'Hebreo', he: 'Hebreo',
  tha: 'Tailandés', th: 'Tailandés', vie: 'Vietnamita', vi: 'Vietnamita', ukr: 'Ucraniano', uk: 'Ucraniano',
  cze: 'Checo', ces: 'Checo', cs: 'Checo', hun: 'Húngaro', hu: 'Húngaro', rum: 'Rumano', ron: 'Rumano', ro: 'Rumano',
  ind: 'Indonesio', id: 'Indonesio',
};

/* Títulos que solo repiten el idioma ("English", "Spanish"): no suman nada al lado del nombre. */
const PLAIN_LANGUAGE_TITLES = new Set([
  'english', 'ingles', 'spanish', 'espanol', 'portuguese', 'portugues', 'french', 'francais', 'frances',
  'italian', 'italiano', 'german', 'deutsch', 'aleman', 'japanese', 'japones', 'russian', 'ruso', 'chinese', 'chino',
  'korean', 'coreano', 'catalan', 'polish', 'polaco', 'dutch', 'turkish', 'turco',
]);

export function languageName(code?: string | null) {
  if (!code) return '';
  const key = code.trim().toLowerCase().replace('_', '-');
  return LANGUAGE_NAMES[key] ?? LANGUAGE_NAMES[key.split('-')[0]] ?? (key === 'und' ? '' : code.toUpperCase());
}

function normalize(text: string) {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
}

export function trackLabel(track: MpvTrack, position: number) {
  const language = languageName(track.language);
  const title = track.title?.trim();
  if (title && !PLAIN_LANGUAGE_TITLES.has(normalize(title))) {
    if (!language || normalize(title).includes(normalize(language))) return title;
    return `${language} · ${title}`;
  }
  if (language) return language;
  return track.kind === 'sub' ? `Subtítulo ${position}` : `Audio ${position}`;
}

const CODEC_NAMES: Record<string, string> = {
  ac3: 'Dolby Digital', eac3: 'Dolby Digital Plus', truehd: 'Dolby TrueHD', dts: 'DTS', 'dts-hd': 'DTS-HD',
  aac: 'AAC', mp3: 'MP3', mp2: 'MP2', opus: 'Opus', vorbis: 'Vorbis', flac: 'FLAC',
  subrip: 'SRT', srt: 'SRT', ass: 'ASS', ssa: 'SSA', webvtt: 'WebVTT', mov_text: 'Texto',
  hdmv_pgs_subtitle: 'Imagen (PGS)', dvd_subtitle: 'Imagen (DVD)', dvb_subtitle: 'Imagen (DVB)',
};

export function channelLabel(channels?: number | null) {
  if (!channels) return '';
  if (channels === 1) return 'Mono';
  if (channels === 2) return 'Estéreo';
  if (channels === 6) return '5.1';
  if (channels === 8) return '7.1';
  return `${channels} canales`;
}

export function trackDetail(track: MpvTrack) {
  const codec = track.codec ? (CODEC_NAMES[track.codec.toLowerCase()] ?? (track.codec.startsWith('pcm') ? 'PCM' : track.codec.toUpperCase())) : '';
  return [
    codec,
    track.kind === 'audio' ? channelLabel(track.channels) : '',
    track.forced ? 'Forzados' : '',
    track.hearingImpaired ? 'Para sordos' : '',
    track.external ? 'Archivo aparte' : '',
    track.defaultTrack ? 'Principal' : '',
  ].filter(Boolean).join(' · ');
}

export function tracksOf(state: MpvState | null, kind: 'audio' | 'sub') {
  return (state?.tracks ?? []).filter(track => track.kind === kind);
}

export function formatDelay(seconds: number) {
  if (Math.abs(seconds) < 0.05) return '0 s';
  const text = Math.abs(seconds).toFixed(1).replace('.', ',');
  return `${seconds > 0 ? '+' : '−'}${text} s`;
}

export const mpvMetadata = async (path: string | null) => {
  const { invoke } = await tauri();
  return invoke<Record<string, unknown>>("mpv_metadata", { path });
};
