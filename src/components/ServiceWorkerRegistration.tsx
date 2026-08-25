import { useEffect } from "react";

/**
 * Registers the production service worker and refreshes once when a new worker takes control.
 *
 * This is intentionally a component effect rather than route-loader work: registration is a browser
 * side effect, should not delay navigation or SSR, and the controller-change listener needs cleanup.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;

    let reloading = false;
    const onControllerChange = () => {
      // A worker activates immediately on deploy; one guarded reload swaps the running app to it.
      if (reloading) return;
      reloading = true;
      window.location.reload();
    };

    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    void navigator.serviceWorker.register("/sw.js").catch(() => {});

    return () =>
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
  }, []);

  return null;
}
