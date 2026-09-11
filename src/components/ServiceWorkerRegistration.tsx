import { CloudAlertIcon } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * Registers the production service worker and refreshes once when a new worker takes control.
 *
 * This is intentionally a component effect rather than route-loader work: registration is a browser
 * side effect, should not delay navigation or SSR, and the controller-change listener needs cleanup.
 */
export function ServiceWorkerRegistration() {
  const [isUnavailable, setIsUnavailable] = useState(false);

  useEffect(() => {
    if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;

    const hadController = navigator.serviceWorker.controller != null;
    let reloading = false;
    let disposed = false;
    let reportedUnavailable = false;
    let installingWorker: ServiceWorker | null = null;

    const reportUnavailable = () => {
      if (disposed || reportedUnavailable) return;
      reportedUnavailable = true;
      console.warn("Service worker registration failed; offline mode is unavailable.");
      setIsUnavailable(true);
    };
    const onInstallStateChange = () => {
      if (installingWorker?.state === "redundant") reportUnavailable();
    };
    const onControllerChange = () => {
      // The first controller already matches the shell loaded from the network. Reload only when an
      // existing controller is replaced by a newly deployed worker.
      if (!hadController || reloading) return;
      reloading = true;
      window.location.reload();
    };

    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    void navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => {
        installingWorker = registration.installing;
        if (installingWorker) {
          installingWorker.addEventListener("statechange", onInstallStateChange);
          onInstallStateChange();
        } else if (!registration.active && !registration.waiting) {
          reportUnavailable();
        }
        return undefined;
      })
      .catch(reportUnavailable);

    return () => {
      disposed = true;
      installingWorker?.removeEventListener("statechange", onInstallStateChange);
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  if (!isUnavailable) return null;

  return (
    <output
      aria-live="polite"
      className="z-navbar border-warning-border bg-surface text-warning fixed inset-e-3 top-14 flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium shadow-sm md:top-3"
    >
      <CloudAlertIcon className="size-4 shrink-0" aria-hidden="true" />
      Offline mode unavailable
    </output>
  );
}
