import { useEffect, useRef } from "react";
import { drawAvatar, type Avatar } from "../game/avatars.js";

// a mascot rendered to a small canvas — used by the shop picker and the lobby roster
export function AvatarThumb({ av, size = 56 }: { av: Avatar; size?: number }): JSX.Element {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, size, size);
    drawAvatar(ctx, av, size / 2, size / 2 - size * 0.06, size * 0.34, -Math.PI / 2);
  }, [av, size]);
  return <canvas ref={ref} width={size} height={size} style={{ width: size, height: size }} />;
}
