export function PwaRecoveryLink() {
  return (
    <a
      href="/pwa-recovery.html"
      data-testid="pwa-recovery-link"
      className="text-text-muted hover:text-accent focus-visible:ring-accent min-h-11 rounded-lg px-2 py-3 text-sm underline decoration-dotted underline-offset-4 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none sm:min-h-9 sm:py-2"
    >
      Still loading? Repair the offline app
    </a>
  );
}
