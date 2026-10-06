import { useEffect, useRef, type RefObject } from "react";

export type FieldPointer = { x: number; y: number };

/**
 * A real-time, locally rendered decorative field — not market/network data.
 * No WebGL or animation dependency: bounded particle counts, capped pixel ratio,
 * 30fps, and no running frame loop when paused, hidden, or outside the viewport.
 * The static shield remains complete even if Canvas is unavailable.
 */
export function OrbitalField({ active, pointer }: { active: boolean; pointer: RefObject<FieldPointer> }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const clock = useRef(0);
  const smoothedPointer = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const context = element.getContext("2d");
    if (!context) return;
    let width = 0;
    let height = 0;
    let frame = 0;
    let last = 0;
    let disposed = false;
    const tau = Math.PI * 2;
    const color = "132, 102, 170";

    function point(angle: number, ring: number, time: number) {
      const orientation = ring === 0 ? -.48 : .77;
      const radius = width * (ring === 0 ? .425 : .365);
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * height * (ring === 0 ? .16 : .29);
      const depth = (Math.sin(angle) + 1) / 2;
      return {
        x: width * .5 + x * Math.cos(orientation) - y * Math.sin(orientation) + smoothedPointer.current.x * (8 + depth * 7),
        y: height * .49 + x * Math.sin(orientation) + y * Math.cos(orientation) + smoothedPointer.current.y * (8 + depth * 7) + Math.sin(time * .6) * 3,
        depth,
      };
    }

    function paint() {
      if (!context || !element || width === 0 || height === 0 || disposed) return;
      const time = clock.current;
      context.clearRect(0, 0, width, height);
      const target = active ? pointer.current : { x: 0, y: 0 };
      smoothedPointer.current.x += (target.x - smoothedPointer.current.x) * .06;
      smoothedPointer.current.y += (target.y - smoothedPointer.current.y) * .06;

      // Quiet constellation around the sculpture. Deterministic positions avoid
      // noisy respawns and keep pause/resume visually continuous.
      const count = width < 460 ? 25 : 44;
      for (let index = 0; index < count; index++) {
        const seed = index * 2.399963;
        const radius = .34 + ((index * 17) % 29) / 130;
        const angle = seed + time * (.007 + (index % 3) * .003);
        const x = width * (.5 + Math.cos(angle) * radius) + smoothedPointer.current.x * (5 + index % 10);
        const y = height * (.49 + Math.sin(angle) * radius * .91) + smoothedPointer.current.y * (5 + index % 10);
        const alpha = .14 + (1 + Math.sin(time * .8 + seed)) * .13;
        const size = index % 9 === 0 ? 1.75 : .75;
        context.fillStyle = `rgba(${color},${alpha})`;
        context.beginPath();
        context.arc(x, y, size, 0, tau);
        context.fill();
        if (index % 9 === 0) {
          context.strokeStyle = `rgba(${color},${alpha * .55})`;
          context.lineWidth = .6;
          context.beginPath();
          context.moveTo(x - 4, y); context.lineTo(x + 4, y);
          context.moveTo(x, y - 4); context.lineTo(x, y + 4);
          context.stroke();
        }
      }

      for (let ring = 0; ring < 2; ring++) {
        context.lineWidth = .7;
        context.strokeStyle = `rgba(${color},${ring === 0 ? .14 : .09})`;
        context.beginPath();
        for (let index = 0; index <= 120; index++) {
          const p = point(index / 120 * tau, ring, time);
          if (index === 0) context.moveTo(p.x, p.y);
          else context.lineTo(p.x, p.y);
        }
        context.stroke();

        // A short, luminous trail rather than a continuous bright ring.
        for (let satellite = 0; satellite < 3; satellite++) {
          const angle = time * (ring === 0 ? .24 : -.16) + satellite * tau / 3 + ring;
          for (let segment = 0; segment < 16; segment++) {
            const p = point(angle - segment * .018 * (ring === 0 ? 1 : -1), ring, time);
            const next = point(angle - (segment + 1) * .018 * (ring === 0 ? 1 : -1), ring, time);
            context.lineWidth = 1.3;
            context.strokeStyle = `rgba(${color},${(1 - segment / 16) * .38})`;
            context.beginPath(); context.moveTo(p.x, p.y); context.lineTo(next.x, next.y); context.stroke();
          }
          const p = point(angle, ring, time);
          const halo = context.createRadialGradient(p.x, p.y, 0, p.x, p.y, 10);
          halo.addColorStop(0, "rgba(174,138,224,.45)");
          halo.addColorStop(1, "rgba(174,138,224,0)");
          context.fillStyle = halo;
          context.beginPath(); context.arc(p.x, p.y, 10, 0, tau); context.fill();
          context.fillStyle = `rgba(122,90,166,${.45 + p.depth * .3})`;
          context.beginPath(); context.arc(p.x, p.y, 1.7 + p.depth * .7, 0, tau); context.fill();
          context.fillStyle = "rgba(255,255,255,.85)";
          context.beginPath(); context.arc(p.x - .5, p.y - .5, .8, 0, tau); context.fill();
        }
      }
    }

    function resize() {
      if (!element || !context) return;
      const bounds = element.getBoundingClientRect();
      width = bounds.width;
      height = bounds.height;
      const ratio = Math.min(window.devicePixelRatio || 1, width < 460 ? 1.25 : 1.75);
      element.width = Math.round(width * ratio);
      element.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      paint();
    }
    function tick(now: number) {
      if (disposed) return;
      if (!last) last = now;
      const delta = now - last;
      if (delta >= 1000 / 30) {
        clock.current += Math.min(delta, 70) / 1000;
        last = now;
        paint();
      }
      frame = requestAnimationFrame(tick);
    }
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    if (active) frame = requestAnimationFrame(tick);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [active, pointer]);

  return <canvas ref={canvas} className="vh-orbital-field" aria-hidden="true" data-running={active ? "true" : "false"} />;
}
