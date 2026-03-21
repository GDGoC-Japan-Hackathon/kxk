"use client";

import { useEffect, useRef } from "react";

type PointerState = {
  currentX: number;
  currentY: number;
  targetX: number;
  targetY: number;
  active: number;
};

export function HeroBackdrop() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    const pointer: PointerState = {
      currentX: 0.5,
      currentY: 0.36,
      targetX: 0.5,
      targetY: 0.36,
      active: 0,
    };

    let width = 0;
    let height = 0;
    let frame = 0;
    let raf = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const updatePointer = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      pointer.targetX = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
      pointer.targetY = Math.min(Math.max((clientY - rect.top) / rect.height, 0), 1);
      pointer.active = 1;
    };

    const handlePointerMove = (event: PointerEvent) => {
      updatePointer(event.clientX, event.clientY);
    };

    const handleTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) return;
      updatePointer(touch.clientX, touch.clientY);
    };

    const handlePointerLeave = () => {
      pointer.targetX = 0.5;
      pointer.targetY = 0.36;
      pointer.active = 0;
    };

    const draw = () => {
      frame += 1;
      pointer.currentX += (pointer.targetX - pointer.currentX) * 0.08;
      pointer.currentY += (pointer.targetY - pointer.currentY) * 0.08;

      ctx.clearRect(0, 0, width, height);

      const gradient = ctx.createLinearGradient(0, 0, 0, height);
      gradient.addColorStop(0, "#02060d");
      gradient.addColorStop(0.55, "#07101a");
      gradient.addColorStop(1, "#0b1420");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);

      const bloomA = ctx.createRadialGradient(
        width * 0.18,
        height * 0.12,
        0,
        width * 0.18,
        height * 0.12,
        width * 0.55,
      );
      bloomA.addColorStop(0, "rgba(91, 160, 255, 0.12)");
      bloomA.addColorStop(1, "rgba(91, 160, 255, 0)");
      ctx.fillStyle = bloomA;
      ctx.fillRect(0, 0, width, height);

      const bloomB = ctx.createRadialGradient(
        width * (0.72 + (pointer.currentX - 0.5) * 0.04),
        height * (0.24 + (pointer.currentY - 0.5) * 0.05),
        0,
        width * 0.72,
        height * 0.24,
        width * 0.46,
      );
      bloomB.addColorStop(0, "rgba(99, 238, 214, 0.09)");
      bloomB.addColorStop(1, "rgba(99, 238, 214, 0)");
      ctx.fillStyle = bloomB;
      ctx.fillRect(0, 0, width, height);

      const columns = Math.max(12, Math.floor(width / 72));
      const rows = Math.max(8, Math.floor(height / 68));
      const cellW = width / columns;
      const cellH = height / rows;
      const influenceRadius = Math.min(width, height) * 0.22;
      const pointerX = pointer.currentX * width;
      const pointerY = pointer.currentY * height;
      const pulse = Math.sin(frame * 0.012) * 0.5 + 0.5;

      const nodes: Array<Array<{ x: number; y: number; influence: number }>> = [];

      for (let row = 0; row <= rows; row += 1) {
        const nodeRow: Array<{ x: number; y: number; influence: number }> = [];
        for (let col = 0; col <= columns; col += 1) {
          const baseX = col * cellW;
          const baseY = row * cellH;
          const dx = baseX - pointerX;
          const dy = baseY - pointerY;
          const distance = Math.hypot(dx, dy);
          const falloff = Math.max(0, 1 - distance / influenceRadius);
          const waveX = Math.sin(frame * 0.01 + row * 0.72) * 1.8;
          const waveY = Math.cos(frame * 0.008 + col * 0.58) * 1.2;
          const pull = falloff * 9;
          const offsetX = waveX + (pointerX - baseX) * 0.016 * falloff + dx * -0.006 * falloff;
          const offsetY = waveY + (pointerY - baseY) * 0.012 * falloff + dy * -0.004 * falloff;

          nodeRow.push({
            x: baseX + offsetX + pull * Math.sin(frame * 0.009 + row + col * 0.3) * 0.18,
            y: baseY + offsetY,
            influence: falloff,
          });
        }
        nodes.push(nodeRow);
      }

      ctx.lineWidth = 1;
      for (let row = 0; row <= rows; row += 1) {
        for (let col = 0; col <= columns; col += 1) {
          const node = nodes[row][col];

          if (col < columns) {
            const next = nodes[row][col + 1];
            const alpha = 0.05 + Math.max(node.influence, next.influence) * 0.09 + pulse * 0.015;
            ctx.strokeStyle = `rgba(126, 170, 255, ${alpha.toFixed(3)})`;
            ctx.beginPath();
            ctx.moveTo(node.x, node.y);
            ctx.lineTo(next.x, next.y);
            ctx.stroke();
          }

          if (row < rows) {
            const next = nodes[row + 1][col];
            const alpha = 0.04 + Math.max(node.influence, next.influence) * 0.08 + pulse * 0.01;
            ctx.strokeStyle = `rgba(92, 229, 203, ${alpha.toFixed(3)})`;
            ctx.beginPath();
            ctx.moveTo(node.x, node.y);
            ctx.lineTo(next.x, next.y);
            ctx.stroke();
          }
        }
      }

      for (let row = 0; row <= rows; row += 1) {
        for (let col = 0; col <= columns; col += 1) {
          const node = nodes[row][col];
          const radius = node.influence > 0.02 ? 1.2 : 0.9;
          const alpha = 0.045 + node.influence * 0.14;
          ctx.fillStyle = `rgba(208, 234, 255, ${alpha.toFixed(3)})`;
          ctx.beginPath();
          ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      ctx.strokeStyle = `rgba(130, 196, 255, ${(0.16 + pointer.active * 0.04).toFixed(3)})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(pointerX, pointerY, 44 + pulse * 8, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = "rgba(167, 220, 255, 0.12)";
      ctx.beginPath();
      ctx.moveTo(pointerX - 18, pointerY);
      ctx.lineTo(pointerX + 18, pointerY);
      ctx.moveTo(pointerX, pointerY - 18);
      ctx.lineTo(pointerX, pointerY + 18);
      ctx.stroke();

      raf = window.requestAnimationFrame(draw);
    };

    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    window.addEventListener("pointerleave", handlePointerLeave);
    window.addEventListener("touchmove", handleTouchMove, { passive: true });
    window.addEventListener("touchend", handlePointerLeave);

    raf = window.requestAnimationFrame(draw);

    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerleave", handlePointerLeave);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handlePointerLeave);
    };
  }, []);

  return (
    <div className="hero-backdrop" aria-hidden="true">
      <canvas ref={canvasRef} className="hero-canvas" />
      <div className="hero-backdrop-vignette" />
      <div className="hero-backdrop-noise" />
      <div className="hero-backdrop-hud">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}
