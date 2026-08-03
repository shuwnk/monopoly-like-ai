// Arcade announcer — chiptune kill callouts (headshot, first blood, multi-kills,
// sprees) synthesised with WebAudio, so there are no audio assets to ship and it has
// that classic square-wave arcade punch. Each callout escalates the motif with the
// combo. Reusable across the shooter minigames.

export interface Announcer {
  /** register a kill the local player scored; plays headshot / multi-kill / spree stings */
  onKill(headshot: boolean): void;
  /** local player died — sad downer + breaks the multi-kill chain and killing spree */
  onDeath(): void;
  /** new match — clear everything, including first-blood */
  reset(): void;
  dispose(): void;
}

const SPREE_AT: Record<number, true> = { 5: true, 10: true, 15: true, 20: true };
const CHAIN_WINDOW = 3.6; // seconds between kills to keep a multi-kill chain alive
const semi = (n: number): number => Math.pow(2, n / 12); // semitone ratio

export function createAnnouncer(): Announcer {
  const Ctor: typeof AudioContext = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ac = new Ctor();
  const master = ac.createGain();
  master.gain.value = 0.32;
  master.connect(ac.destination);

  // schedule one arcade note `at` seconds from now
  const note = (freq: number, at: number, dur: number, type: OscillatorType, peak: number, sweepTo?: number): void => {
    const t = ac.currentTime + at;
    const o = ac.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (sweepTo !== undefined) o.frequency.exponentialRampToValueAtTime(Math.max(1, sweepTo), t + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0007, t + dur);
    o.connect(g);
    g.connect(master);
    o.start(t);
    o.stop(t + dur + 0.02);
  };

  // ── motifs (each schedules from offset `at`, returns its length so callouts chain) ──
  const headshotSfx = (at: number): number => {
    note(1975, at, 0.05, "square", 0.3, 720); // laser zap down
    note(2637, at + 0.05, 0.14, "square", 0.26); // crisp "ting"
    return 0.22;
  };
  const firstBloodSfx = (at: number): number => {
    note(150, at, 0.13, "triangle", 0.34, 80); // low impact thud
    [523.25, 659.25, 783.99].forEach((f, i) => note(f, at + 0.1 + i * 0.05, 0.13, "square", 0.26));
    return 0.36;
  };
  const multiKillSfx = (chain: number, at: number): number => {
    const roots = [0, 0, 523.25, 587.33, 659.25, 783.99, 880]; // Double…Monster get a higher root
    const root = roots[Math.min(chain, 6)]!;
    const steps = [0, 4, 7, 12, 16, 19]; // ascending major arpeggio
    const n = Math.min(2 + chain, 6); // more notes as it escalates
    for (let i = 0; i < n; i++) note(root * semi(steps[i]!), at + i * 0.07, 0.13, "square", 0.3);
    note(root * 2, at + n * 0.07, 0.22, "square", 0.33); // octave accent
    return n * 0.07 + 0.24;
  };
  const spreeSfx = (at: number): number => {
    const run = [523.25, 587.33, 659.25, 783.99, 880, 987.77, 1046.5];
    run.forEach((f, i) => {
      note(f, at + i * 0.06, 0.12, "square", 0.28);
      note(f / 2, at + i * 0.06, 0.12, "triangle", 0.14); // octave-down body
    });
    note(1046.5, at + run.length * 0.06, 0.32, "square", 0.34);
    return run.length * 0.06 + 0.34;
  };

  let totalKills = 0;
  let chain = 0;
  let lastKill = -Infinity;
  let spree = 0;

  return {
    onKill(headshot) {
      void ac.resume();
      const t = performance.now() / 1000;
      totalKills++;
      spree++;
      chain = t - lastKill <= CHAIN_WINDOW ? chain + 1 : 1;
      lastKill = t;

      // stack the stings back-to-back so they read as one escalating flourish
      let at = 0;
      if (totalKills === 1) at += firstBloodSfx(at);
      if (headshot) at += headshotSfx(at);
      if (chain >= 2) at += multiKillSfx(chain, at);
      if (SPREE_AT[spree]) at += spreeSfx(at);
    },
    onDeath() {
      void ac.resume();
      note(440, 0, 0.14, "triangle", 0.26, 320);
      note(300, 0.13, 0.24, "triangle", 0.24, 150); // downer
      chain = 0;
      spree = 0;
      lastKill = -Infinity;
    },
    reset() {
      totalKills = 0;
      chain = 0;
      spree = 0;
      lastKill = -Infinity;
    },
    dispose() {
      void ac.close();
    },
  };
}
