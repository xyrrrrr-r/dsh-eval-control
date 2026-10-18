/**
 * The single <style> tag the dashboard injects (guarded for non-browser
 * loads, e.g. the Node test harness). Inline styles carry the layout; this
 * sheet only holds what they cannot: the pulse keyframes and scrollbar
 * polish.
 */
let injected = false;

export function injectStyles(): void {
  if (injected || typeof document === 'undefined' || !document.head) return;
  injected = true;
  const style = document.createElement('style');
  style.id = 'dsh-eval-control-styles';
  style.textContent = `
@keyframes dsh-eval-pulse-keyframes {
  0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, currentColor 35%, transparent); }
  50% { box-shadow: 0 0 0 5px transparent; }
}
.dsh-eval-pulse { animation: dsh-eval-pulse-keyframes 1.6s ease-in-out infinite; }
.dsh-eval-overview-layout { display: grid; grid-template-columns: minmax(0, 1fr) minmax(300px, 380px); gap: 16px; align-items: start; }
.dsh-eval-overview-diagnostics { display: grid; gap: 10px; min-width: 0; position: sticky; top: 80px; max-height: calc(100vh - 170px); overflow: auto; }
@media (max-width: 980px) { .dsh-eval-overview-layout { grid-template-columns: minmax(0, 1fr); } .dsh-eval-overview-diagnostics { position: static; max-height: none; } }
.dsh-eval-metric-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.dsh-eval-tab-content { animation: dsh-eval-tab-in .18s ease-out; }
@keyframes dsh-eval-tab-in { from { opacity: .4; } to { opacity: 1; } }
.dsh-eval-skeleton { animation: dsh-eval-pulse-keyframes 1.6s infinite; }
@media (max-width: 640px) { .dsh-eval-metric-grid { grid-template-columns: minmax(0, 1fr); } }
@media (prefers-reduced-motion: reduce) {
  .dsh-eval-pulse, .dsh-eval-tab-content, .dsh-eval-skeleton { animation: none; }
}
`;
  document.head.appendChild(style);
}
