// Ambient globals. A plain script-scoped .d.ts (no top-level import/export), so these interfaces
// merge with the DOM's.

interface Window {
  /**
   * Debug/test surface, installed by the inline script in index.html before the module graph loads.
   * tools/smoke.ts polls `ready` and asserts `errors` is empty; `api` is filled in by src/main.ts.
   */
  __game?: {
    ready: boolean;
    errors: string[];
    api?: Record<string, (...args: any[]) => any>;
  };
}

interface Window {
  /** Safari still ships the prefixed WebAudio constructors; src/lib/audio/facade.ts falls back to them. */
  webkitAudioContext?: typeof AudioContext;
  webkitOfflineAudioContext?: typeof OfflineAudioContext;
}
