// Is developer UI allowed to show? True under `vite dev`, false in a production
// build — Vite substitutes `import.meta.env.DEV` with a literal at build time.
// Gates the debug panel and the diagnostic test screens so nobody playing the
// deployed game sees them.
//
// Note this HIDES rather than strips: the components are still reachable from
// the module graph (App.tsx routes to the test screens, HotseatGame imports the
// panel), so Rollup keeps them in the bundle. Getting them out of the download
// too means code-splitting them behind a dynamic import.
//
// Deliberately not a runtime flag like `?debug=1` — that would be one URL away
// from any player, and the debug panel can patch game state.
export const DEV: boolean = import.meta.env.DEV;
