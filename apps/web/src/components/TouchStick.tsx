import { useEffect, useRef } from "react";

// Drag-anywhere thumbstick for the party minigames on a phone. Press anywhere in
// the play area and the stick appears under your thumb; drag to steer. Output is
// the same 8-way signed vector the keyboard produces, so the wire protocol and
// the sim are untouched.
//
// It only answers touch pointers, so a mouse or pen still falls through to
// whatever is underneath — desktop players never see it.
const DEAD_PX = 14; // slack before an axis reads as pressed
const RANGE_PX = 52; // how far the knob travels from the origin

export function TouchStick({ onChange }: { onChange: (dx: number, dy: number) => void }): JSX.Element {
  const padRef = useRef<HTMLDivElement | null>(null);
  const baseRef = useRef<HTMLDivElement | null>(null);
  const knobRef = useRef<HTMLDivElement | null>(null);
  // the callback is read through a ref so a re-rendering parent doesn't tear
  // down the listeners (and drop a touch mid-drag)
  const cb = useRef(onChange);
  cb.current = onChange;

  useEffect(() => {
    const pad = padRef.current!;
    const base = baseRef.current!;
    const knob = knobRef.current!;
    let touchId: number | null = null;
    let ox = 0;
    let oy = 0;
    const sent = { dx: 0, dy: 0 };

    function show(on: boolean): void {
      base.style.opacity = on ? "1" : "0";
    }
    function place(x: number, y: number): void {
      const r = pad.getBoundingClientRect();
      base.style.left = `${x - r.left}px`;
      base.style.top = `${y - r.top}px`;
    }
    function send(dx: number, dy: number): void {
      if (dx === sent.dx && dy === sent.dy) return;
      sent.dx = dx;
      sent.dy = dy;
      cb.current(dx, dy);
    }

    function down(e: PointerEvent): void {
      if (e.pointerType !== "touch" || touchId !== null) return;
      touchId = e.pointerId;
      ox = e.clientX;
      oy = e.clientY;
      pad.setPointerCapture(e.pointerId);
      place(ox, oy);
      knob.style.transform = "translate(0px, 0px)";
      show(true);
      e.preventDefault();
    }
    function move(e: PointerEvent): void {
      if (e.pointerId !== touchId) return;
      const vx = e.clientX - ox;
      const vy = e.clientY - oy;
      const len = Math.hypot(vx, vy);
      const k = len > RANGE_PX ? RANGE_PX / len : 1;
      knob.style.transform = `translate(${vx * k}px, ${vy * k}px)`;
      send(Math.abs(vx) > DEAD_PX ? Math.sign(vx) : 0, Math.abs(vy) > DEAD_PX ? Math.sign(vy) : 0);
      e.preventDefault();
    }
    function up(e: PointerEvent): void {
      if (e.pointerId !== touchId) return;
      touchId = null;
      show(false);
      send(0, 0);
    }

    pad.addEventListener("pointerdown", down);
    pad.addEventListener("pointermove", move);
    pad.addEventListener("pointerup", up);
    pad.addEventListener("pointercancel", up);
    return () => {
      pad.removeEventListener("pointerdown", down);
      pad.removeEventListener("pointermove", move);
      pad.removeEventListener("pointerup", up);
      pad.removeEventListener("pointercancel", up);
      if (sent.dx || sent.dy) cb.current(0, 0); // never leave a fighter running
    };
  }, []);

  return (
    <div ref={padRef} style={{ position: "absolute", inset: 0, touchAction: "none" }}>
      <div
        ref={baseRef}
        style={{
          position: "absolute",
          width: RANGE_PX * 2,
          height: RANGE_PX * 2,
          marginLeft: -RANGE_PX,
          marginTop: -RANGE_PX,
          borderRadius: "50%",
          border: "2px solid rgba(255,255,255,0.35)",
          background: "rgba(255,255,255,0.06)",
          opacity: 0,
          transition: "opacity 120ms",
          pointerEvents: "none",
        }}
      >
        <div
          ref={knobRef}
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            width: 46,
            height: 46,
            marginLeft: -23,
            marginTop: -23,
            borderRadius: "50%",
            background: "rgba(255,255,255,0.8)",
            boxShadow: "0 2px 10px rgba(0,0,0,0.5)",
          }}
        />
      </div>
    </div>
  );
}
