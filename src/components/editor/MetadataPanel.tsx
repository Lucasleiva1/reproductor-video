/* Panel "Metadata": todo lo que se puede saber del video abierto, ordenado y en castellano.
   Lo lee mpv (contenedor, pistas, etiquetas, capítulos) más las fechas del archivo en el disco. */

import { useEffect, useMemo, useState } from "react";
import { Copy, LoaderCircle } from "lucide-react";
import { languageName, mpvMetadata, useMpv } from "@/player/mpv";

type Row = [string, string];
type Section = { title: string; rows: Row[] };
type Json = Record<string, unknown>;

const num = (value: unknown) => {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
};
const str = (value: unknown) => (value === null || value === undefined || value === "" ? null : String(value));

const formatBytes = (bytes: number | null) => {
  if (bytes === null) return null;
  const units = ["bytes", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const text = unit === 0 ? String(value) : value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2).replace(".", ",");
  return `${text} ${units[unit]} (${bytes.toLocaleString("es-AR")} bytes)`;
};

const formatDuration = (seconds: number | null) => {
  if (seconds === null) return null;
  const total = Math.max(0, seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const clock = `${h > 0 ? `${h}:${String(m).padStart(2, "0")}` : m}:${s.toFixed(2).padStart(5, "0").replace(".", ",")}`;
  return `${clock} (${total.toFixed(3).replace(".", ",")} s)`;
};

const formatDate = (value: unknown) => {
  const text = str(value);
  if (!text) return null;
  const asNumber = num(value);
  const date = asNumber !== null && asNumber > 1e11 ? new Date(asNumber) : new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  return date.toLocaleString("es-AR", { dateStyle: "full", timeStyle: "medium" });
};

const formatBitrate = (value: unknown) => {
  const n = num(value);
  if (n === null || n <= 0) return null;
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2).replace(".", ",")} Mbps` : `${Math.round(n / 1000)} kbps`;
};

const formatFps = (value: unknown) => {
  const n = num(value);
  return n === null || n <= 0 ? null : `${n.toFixed(3).replace(/\.?0+$/, "").replace(".", ",")} cuadros por segundo`;
};

const channelsText = (value: unknown) => {
  const n = num(value);
  if (n === null) return str(value);
  if (n === 1) return "1 (mono)";
  if (n === 2) return "2 (estéreo)";
  if (n === 6) return "6 (5.1)";
  if (n === 8) return "8 (7.1)";
  return String(n);
};

const FORMAT_NAMES: Array<[RegExp, string]> = [
  [/matroska|mkv/i, "MKV (Matroska)"],
  [/webm/i, "WebM"],
  [/mp4|m4v/i, "MP4"],
  [/mov|quicktime/i, "MOV (QuickTime)"],
  [/avi/i, "AVI"],
  [/mpegts/i, "MPEG-TS"],
  [/mpeg/i, "MPEG"],
  [/flv/i, "FLV (Flash)"],
  [/asf|wmv/i, "WMV / ASF"],
  [/ogg/i, "Ogg"],
];
const formatName = (value: unknown) => {
  const text = str(value);
  if (!text) return null;
  const known = FORMAT_NAMES.find(([pattern]) => pattern.test(text));
  return known ? `${known[1]} · ${text}` : text;
};

/* Etiquetas que dicen cuándo se filmó, con qué y dónde. */
const DATE_KEY = /creation_?time|creationdate|^date$|date_?recorded|recorded|year/i;
const CAMERA_KEY = /make|model|manufacturer|software|encoder|handler|com\.android\.version|camera|lens/i;
const PLACE_KEY = /location|gps|xyz/i;

const tagLabel = (key: string) => {
  const clean = key.replace(/^com\.apple\.quicktime\./i, "").replace(/^com\.android\./i, "");
  const names: Record<string, string> = {
    creation_time: "Fecha de creación", creationdate: "Fecha de filmación", date: "Fecha", year: "Año",
    make: "Marca del equipo", model: "Modelo del equipo", manufacturer: "Fabricante", software: "Programa",
    encoder: "Codificado con", handler_name: "Manejador", title: "Título", artist: "Artista", comment: "Comentario",
    description: "Descripción", location: "Ubicación", "location.iso6709": "Ubicación (GPS)", xyz: "Ubicación (GPS)",
    major_brand: "Marca del formato", minor_version: "Versión del formato", compatible_brands: "Formatos compatibles",
    copyright: "Derechos", album: "Álbum", genre: "Género", language: "Idioma", version: "Versión de Android",
  };
  return names[clean.toLowerCase()] ?? clean;
};

function buildSections(data: Json): Section[] {
  const sections: Section[] = [];
  const add = (title: string, rows: Array<[string, string | null | undefined]>) => {
    const clean = rows.filter((row): row is Row => !!row[1]);
    if (clean.length) sections.push({ title, rows: clean });
  };

  const disk = (data.disk ?? {}) as Json;
  const path = str(data.path) ?? "";
  const tags = (data.metadata && typeof data.metadata === "object" ? data.metadata : {}) as Json;
  const tracks = (Array.isArray(data["track-list"]) ? data["track-list"] : []) as Json[];
  const videoParams = (data["video-params"] && typeof data["video-params"] === "object" ? data["video-params"] : {}) as Json;
  const audioParams = (data["audio-params"] && typeof data["audio-params"] === "object" ? data["audio-params"] : {}) as Json;
  const tagEntries = Object.entries(tags).map(([key, value]) => [key, str(value) ?? ""] as [string, string]);

  add("Archivo", [
    ["Nombre", str(data.filename) ?? path.split(/[\\/]/).pop()],
    ["Carpeta", path.includes("\\") || path.includes("/") ? path.replace(/[\\/][^\\/]*$/, "") : null],
    ["Tamaño", formatBytes(num(disk.size) ?? num(data["file-size"]))],
    ["Creado en esta computadora", formatDate(disk.created)],
    ["Última modificación", formatDate(disk.modified)],
    ["Solo lectura", disk.readOnly === true ? "Sí" : null],
  ]);

  const shotDates = tagEntries.filter(([key]) => DATE_KEY.test(key));
  add("Cuándo se filmó", shotDates.length
    ? shotDates.map(([key, value]) => [tagLabel(key), formatDate(value)])
    : [["Fecha de filmación", "El archivo no trae la fecha de filmación guardada adentro."]]);

  add("Equipo y lugar", tagEntries
    .filter(([key]) => CAMERA_KEY.test(key) || PLACE_KEY.test(key))
    .map(([key, value]) => [tagLabel(key), value]));

  const totalBitrate = (() => {
    const size = num(disk.size) ?? num(data["file-size"]);
    const duration = num(data.duration);
    return size && duration ? formatBitrate((size * 8) / duration) : null;
  })();
  add("Formato", [
    ["Contenedor", formatName(data["file-format"])],
    ["Duración", formatDuration(num(data.duration))],
    ["Bitrate total (promedio)", totalBitrate],
    ["Empieza en", num(data["demuxer-start-time"]) ? formatDuration(num(data["demuxer-start-time"])) : null],
    ["Se puede adelantar", data.seekable === "yes" ? "Sí" : data.seekable === "no" ? "No" : null],
  ]);

  const videoTrack = tracks.find((track) => track.type === "video" && track.selected) ?? tracks.find((track) => track.type === "video");
  if (videoTrack) {
    const w = num(videoParams.w) ?? num(videoTrack["demux-w"]) ?? num(data.width);
    const h = num(videoParams.h) ?? num(videoTrack["demux-h"]) ?? num(data.height);
    const dw = num(videoParams.dw) ?? num(data.dwidth);
    const dh = num(videoParams.dh) ?? num(data.dheight);
    add("Video", [
      ["Códec", str(data["video-format"]) ?? str(videoTrack.codec)],
      ["Descripción del códec", str(data["video-codec"]) ?? str(videoTrack["codec-desc"])],
      ["Perfil", str(videoTrack["codec-profile"])],
      ["Resolución", w && h ? `${w} × ${h} píxeles` : null],
      ["Se ve como", dw && dh && (dw !== w || dh !== h) ? `${dw} × ${dh} píxeles` : null],
      ["Relación de aspecto", num(videoParams.aspect) ? (num(videoParams.aspect) as number).toFixed(3).replace(".", ",") : null],
      ["Cuadros por segundo", formatFps(data["container-fps"] ?? videoTrack["demux-fps"])],
      ["Bitrate del video", formatBitrate(data["video-bitrate"] ?? videoTrack["demux-bitrate"])],
      ["Formato de píxel", str(videoParams.pixelformat)],
      ["Profundidad de color", num(videoParams["plane-depth"]) ? `${videoParams["plane-depth"]} bits` : null],
      ["Matriz de color", str(videoParams.colormatrix)],
      ["Rango de color", str(videoParams.colorlevels) === "limited" ? "Limitado (TV)" : str(videoParams.colorlevels) === "full" ? "Completo (PC)" : str(videoParams.colorlevels)],
      ["Colores primarios", str(videoParams.primaries)],
      ["Curva de luz", str(videoParams.gamma)],
      ["HDR", ["pq", "hlg"].includes(String(videoParams.gamma)) ? `Sí (${String(videoParams.gamma).toUpperCase()})` : "No"],
      ["Brillo máximo (HDR)", num(videoParams["max-luma"]) ? `${videoParams["max-luma"]} nits` : null],
      ["Rotación guardada", num(videoParams.rotate) ? `${videoParams.rotate}°` : null],
      ["Decodificado por", str(data["hwdec-current"]) && data["hwdec-current"] !== "no" ? `Placa de video (${data["hwdec-current"]})` : "Procesador"],
    ]);
  }

  tracks.filter((track) => track.type === "audio").forEach((track, index, list) => {
    const selected = track.selected === true;
    add(list.length > 1 ? `Audio ${index + 1}${selected ? " (el que suena)" : ""}` : "Audio", [
      ["Idioma", track.lang ? `${languageName(String(track.lang))} (${track.lang})` : null],
      ["Nombre", str(track.title)],
      ["Códec", [str(track.codec), str(track["codec-desc"])].filter(Boolean).join(" · ") || null],
      ["Perfil", str(track["codec-profile"])],
      ["Canales", channelsText(track["demux-channel-count"] ?? (selected ? audioParams["channel-count"] : null))],
      ["Distribución", /^unknown/i.test(String(track["demux-channels"] ?? "")) ? null : str(track["demux-channels"])],
      ["Frecuencia", num(track["demux-samplerate"] ?? (selected ? audioParams.samplerate : null)) ? `${track["demux-samplerate"] ?? audioParams.samplerate} Hz` : null],
      ["Bitrate", formatBitrate(track["demux-bitrate"] ?? (selected ? data["audio-bitrate"] : null))],
      ["Principal", track.default === true ? "Sí" : null],
      ["Archivo aparte", track.external === true ? str(track["external-filename"]) ?? "Sí" : null],
    ]);
  });

  tracks.filter((track) => track.type === "sub").forEach((track, index, list) => {
    add(list.length > 1 ? `Subtítulo ${index + 1}` : "Subtítulo", [
      ["Idioma", track.lang ? `${languageName(String(track.lang))} (${track.lang})` : null],
      ["Nombre", str(track.title)],
      ["Formato", str(track.codec)],
      ["Forzados", track.forced === true ? "Sí" : null],
      ["Para sordos", track["hearing-impaired"] === true ? "Sí" : null],
      ["Archivo aparte", track.external === true ? str(track["external-filename"]) ?? "Sí" : null],
    ]);
  });

  const chapters = (Array.isArray(data["chapter-list"]) ? data["chapter-list"] : []) as Json[];
  add("Capítulos", chapters.map((chapter, index) => [
    `${index + 1}. ${formatDuration(num(chapter.time))?.split(" ")[0] ?? ""}`,
    str(chapter.title) ?? "Sin nombre",
  ]));

  add("Todas las etiquetas del archivo", tagEntries.map(([key, value]) => [key, value]));
  return sections;
}

export function MetadataSection({ videoPath }: { videoPath: string | null }) {
  const session = useMpv((s) => s.session);
  const loaded = useMpv((s) => !!s.state?.loaded && s.state.session === s.session);
  const [data, setData] = useState<Json | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!loaded) return;
    let cancelled = false;
    setError(null);
    mpvMetadata(videoPath)
      .then((result) => { if (!cancelled) setData(result as Json); })
      .catch((err) => { if (!cancelled) setError(String(err)); });
    return () => { cancelled = true; };
  }, [session, loaded, videoPath]);

  const sections = useMemo(() => (data ? buildSections(data) : []), [data]);

  const copyAll = async () => {
    const text = sections
      .map((section) => [section.title.toUpperCase(), ...section.rows.map(([label, value]) => `${label}: ${value}`)].join("\n"))
      .join("\n\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {}
  };

  if (error) return <p className="text-[11px] text-red-300">No se pudo leer la información: {error}</p>;
  if (!data) {
    return (
      <div className="flex items-center gap-2 text-[11px] text-white/50">
        <LoaderCircle className="h-4 w-4 animate-spin" /> Leyendo la información del video…
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={copyAll}
        className="mb-3 flex w-full items-center justify-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/75 transition-colors hover:bg-white/10 hover:text-white"
      >
        <Copy className="h-3.5 w-3.5" />
        {copied ? "Copiado" : "Copiar toda la información"}
      </button>
      {sections.map((section) => (
        <div key={section.title} className="mb-4">
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/40">{section.title}</div>
          <div className="rounded-md border border-white/10 bg-white/[0.03]">
            {section.rows.map(([label, value], index) => (
              <div
                key={`${label}-${index}`}
                className={`grid grid-cols-[minmax(90px,40%)_1fr] gap-2 px-2.5 py-1.5 text-[11px] ${index > 0 ? "border-t border-white/5" : ""}`}
              >
                <span className="text-white/50 [overflow-wrap:anywhere]">{label}</span>
                <span className="text-white/90 [overflow-wrap:anywhere] select-text">{value}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}
