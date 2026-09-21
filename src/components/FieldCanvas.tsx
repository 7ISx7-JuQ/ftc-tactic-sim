import { useEffect, useRef } from 'react';
import { CANVAS_SIZE_PX, renderField } from '../renderer/canvasRenderer';

export default function FieldCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 고해상도 디스플레이 대응: 내부 버퍼만 확대하고 논리 좌표는 720x720 유지
    const dpr = window.devicePixelRatio || 1;
    canvas.width = CANVAS_SIZE_PX * dpr;
    canvas.height = CANVAS_SIZE_PX * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    renderField(ctx);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      width={CANVAS_SIZE_PX}
      height={CANVAS_SIZE_PX}
      style={{ width: CANVAS_SIZE_PX, height: CANVAS_SIZE_PX, display: 'block' }}
    />
  );
}
