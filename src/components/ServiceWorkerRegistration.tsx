import { CloudAlertIcon } from "lucide-react";
import { useEffect, useState } from "react";

const MESSAGE_TYPE = "transactions-tracker:service-worker";

/** Registers the production worker without interrupting the document currently in use. */
export function ServiceWorkerRegistration() {
  const [isUnavailable, setIsUnavailable] = useState(false);
  const [isUpdateReady, setIsUpdateReady] = useState(false);

  useEffect(() => {
    if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;

    let disposed = false;
    let reportedUnavailable = false;
    let activeBuildId: string | null = null;
    let installingWorker: ServiceWorker | null = null;
    let onInstallStateChange: (() => void) | undefined;
    let removeUpdateListener: (() => void) | undefined;

    const reportUnavailable = () => {
      if (disposed || reportedUnavailable) return;
      reportedUnavailable = true;
      console.warn("Service worker registration failed; offline mode is unavailable.");
      setIsUnavailable(true);
    };
    const requestBuildId = () => {
      navigator.serviceWorker.controller?.postMessage({
        type: MESSAGE_TYPE,
        action: "get-build-id",
      });
    };
    const onMessage = (event: MessageEvent) => {
      const message = event.data;
      if (message?.type !== MESSAGE_TYPE) return;
      if (message.action === "build-id" && typeof message.buildId === "string") {
        activeBuildId = message.buildId;
        return;
      }
      if (message.action === "request-client-build-id") {
        event.source?.postMessage({
          type: MESSAGE_TYPE,
          action: "client-build-id",
          requestId: message.requestId,
          buildId: activeBuildId,
        });
      }
    };
    const watchInstallingWorker = (
      worker: ServiceWorker | null,
      registration: ServiceWorkerRegistration,
    ) => {
      if (installingWorker && onInstallStateChange) {
        installingWorker.removeEventListener("statechange", onInstallStateChange);
      }
      installingWorker = worker;
      onInstallStateChange = () => {
        if (installingWorker?.state === "installed" && registration.waiting) {
          setIsUpdateReady(true);
        } else if (installingWorker?.state === "redundant" && !registration.active) {
          reportUnavailable();
        }
      };
      installingWorker?.addEventListener("statechange", onInstallStateChange);
      onInstallStateChange();
    };
    const onUpdateFound = (registration: ServiceWorkerRegistration) => {
      watchInstallingWorker(registration.installing, registration);
    };

    navigator.serviceWorker.addEventListener("message", onMessage);
    void navigator.storage?.persist?.().catch(() => undefined);
    void navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => {
        requestBuildId();
        if (registration.waiting) setIsUpdateReady(true);
        onUpdateFound(registration);
        const handleUpdateFound = () => onUpdateFound(registration);
        registration.addEventListener("updatefound", handleUpdateFound);
        removeUpdateListener = () =>
          registration.removeEventListener("updatefound", handleUpdateFound);
        if (disposed) removeUpdateListener();
        return undefined;
      })
      .catch(reportUnavailable);

    return () => {
      disposed = true;
      if (installingWorker && onInstallStateChange) {
        installingWorker.removeEventListener("statechange", onInstallStateChange);
      }
      removeUpdateListener?.();
      navigator.serviceWorker.removeEventListener("message", onMessage);
    };
  }, []);

  if (!isUnavailable && !isUpdateReady) return null;

  return (
    <output
      aria-live="polite"
      className="z-navbar border-warning-border bg-surface text-warning fixed inset-e-3 top-14 flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium shadow-sm md:top-3"
    >
      <CloudAlertIcon className="size-4 shrink-0" aria-hidden="true" />
      {isUnavailable
        ? "Offline mode unavailable"
        : "Update ready. Finish your edits, then close all app windows and reopen."}
    </output>
  );
}
