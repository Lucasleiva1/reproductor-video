import { useEffect, useState } from "react";
import { Download, RefreshCw, CheckCircle2, AlertTriangle } from "lucide-react";

// Updates are published as GitHub Releases (latest.json + signed NSIS installer).
// The Tauri updater verifies the signature against the public key in tauri.conf.json.

const hasTauriIpc = () =>
  typeof (window as Window & { __TAURI_IPC__?: unknown }).__TAURI_IPC__ === "function" &&
  "__TAURI_METADATA__" in window;

type UpdateState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "up-to-date" }
  | { kind: "available"; version: string; notes: string }
  | { kind: "installing" }
  | { kind: "error"; message: string };

const describeError = (error: unknown) => {
  const text = error instanceof Error ? error.message : String(error ?? "");
  if (/404|not found|Could not fetch a valid release JSON/i.test(text)) {
    return "Todavía no hay versiones publicadas en GitHub.";
  }
  if (/network|connect|dns|timed out|offline/i.test(text)) {
    return "No hay conexión a internet. Probá de nuevo en un rato.";
  }
  if (/signature/i.test(text)) {
    return "La actualización no tiene una firma válida y no se instaló.";
  }
  return text || "No se pudo buscar la actualización.";
};

export default function UpdateSection() {
  const [installedVersion, setInstalledVersion] = useState<string | null>(null);
  const [state, setState] = useState<UpdateState>({ kind: "idle" });
  const isDesktop = hasTauriIpc();

  useEffect(() => {
    if (!isDesktop) return;
    import("@tauri-apps/api/app")
      .then(({ getVersion }) => getVersion())
      .then(setInstalledVersion)
      .catch(() => setInstalledVersion(null));
  }, [isDesktop]);

  const checkForUpdate = async () => {
    if (!isDesktop) {
      setState({ kind: "error", message: "Las actualizaciones solo funcionan en la aplicación instalada." });
      return;
    }
    setState({ kind: "checking" });
    try {
      const { checkUpdate } = await import("@tauri-apps/api/updater");
      const { shouldUpdate, manifest } = await checkUpdate();
      if (shouldUpdate && manifest) {
        setState({ kind: "available", version: manifest.version, notes: manifest.body?.trim() ?? "" });
      } else {
        setState({ kind: "up-to-date" });
      }
    } catch (error) {
      setState({ kind: "error", message: describeError(error) });
    }
  };

  const installAvailableUpdate = async () => {
    setState({ kind: "installing" });
    let unlisten: (() => void) | undefined;
    try {
      const { installUpdate, onUpdaterEvent } = await import("@tauri-apps/api/updater");
      const { relaunch } = await import("@tauri-apps/api/process");
      unlisten = await onUpdaterEvent(({ error, status }) => {
        if (status === "ERROR") setState({ kind: "error", message: describeError(error) });
      });
      // On Windows the installer closes the app by itself; relaunch covers the other cases.
      await installUpdate();
      await relaunch();
    } catch (error) {
      setState({ kind: "error", message: describeError(error) });
    } finally {
      unlisten?.();
    }
  };

  const busy = state.kind === "checking" || state.kind === "installing";

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2">
        <RefreshCw className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-sm font-medium text-foreground">Actualización</span>
      </div>

      <div className="flex items-center justify-between rounded-lg border border-border/50 bg-muted/20 px-3 py-2">
        <span className="text-[11px] text-muted-foreground">Versión instalada</span>
        <span className="font-mono text-xs font-semibold text-foreground">
          {installedVersion ? `v${installedVersion}` : "—"}
        </span>
      </div>

      {state.kind === "up-to-date" && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-400">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
          Ya tenés la última versión.
        </div>
      )}

      {state.kind === "available" && (
        <div className="space-y-2 rounded-lg border border-indigo-500/40 bg-indigo-500/10 px-3 py-2.5">
          <div className="text-[11px] font-semibold text-indigo-300">
            Hay una versión nueva: v{state.version}
          </div>
          {state.notes && (
            <div className="max-h-24 overflow-y-auto whitespace-pre-line text-[10px] leading-relaxed text-muted-foreground">
              {state.notes}
            </div>
          )}
          <button
            onClick={installAvailableUpdate}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-indigo-500 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-indigo-400"
          >
            <Download className="w-3.5 h-3.5" />
            Instalar actualización
          </button>
        </div>
      )}

      {state.kind === "installing" && (
        <div className="flex items-center gap-2 rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-3 py-2 text-[11px] text-indigo-300">
          <RefreshCw className="w-3.5 h-3.5 shrink-0 animate-spin" />
          Descargando e instalando… la app se va a cerrar y volver a abrir sola.
        </div>
      )}

      {state.kind === "error" && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-300">
          <AlertTriangle className="mt-0.5 w-3.5 h-3.5 shrink-0" />
          <span>{state.message}</span>
        </div>
      )}

      {state.kind !== "available" && (
        <button
          onClick={checkForUpdate}
          disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-border/50 bg-muted/30 px-3 py-2 text-[11px] font-medium text-foreground transition-all hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${state.kind === "checking" ? "animate-spin" : ""}`} />
          {state.kind === "checking" ? "Buscando…" : "Buscar actualización"}
        </button>
      )}
    </div>
  );
}
