// Rewired's keyboard "digital axis simulation", which is how Pummel Party reads
// Horizontal / Vertical for the third-person minigames (FINDINGS.md §13: A/D, W/S are a
// digital axis with gravity 3 and sensitivity 3; BarnBrawlPlayer.DoMovement feeds
// `GetAxis(Horizontal/Vertical)` to the mover). A held key ramps the axis toward ±1 at
// `sensitivity` per second, a released key lets it fall back to 0 at `gravity` per
// second, and pressing the opposite key snaps through 0 first. A third of a second from
// standing to full input (and back) is a large part of the game's movement feel.

export interface DigitalAxisTuning {
  /** units/s the axis moves toward the held direction */
  sensitivity: number;
  /** units/s the axis falls back to 0 once released */
  gravity: number;
  /** reversing direction resets the axis to 0 before ramping the other way */
  snap: boolean;
}

export const REWIRED_DIGITAL_AXIS: DigitalAxisTuning = { sensitivity: 3, gravity: 3, snap: true };

export class DigitalAxis {
  value = 0;
  constructor(private readonly tuning: DigitalAxisTuning = REWIRED_DIGITAL_AXIS) {}

  /** advance toward `target` (−1, 0 or 1, the keys held this frame) and return the axis */
  update(target: number, dt: number): number {
    const t = this.tuning;
    const goal = Math.max(-1, Math.min(1, target));
    if (goal === 0) {
      const step = t.gravity * dt;
      this.value = Math.abs(this.value) <= step ? 0 : this.value - Math.sign(this.value) * step;
    } else {
      if (t.snap && this.value !== 0 && Math.sign(this.value) !== Math.sign(goal)) this.value = 0;
      const step = t.sensitivity * dt;
      const d = goal - this.value;
      this.value = Math.abs(d) <= step ? goal : this.value + Math.sign(d) * step;
    }
    return this.value;
  }

  reset(): void {
    this.value = 0;
  }
}
