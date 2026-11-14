'use client';

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import FlipAlbumCard from '@/components/FlipAlbumCard';
import type { AlbumTrackInfo, TrackEntry } from '@/lib/spotify-track';

export interface AlbumItem {
  id: number;
  label: string;
  title: string;
  artist: string;
  imageUrl: string;
  spotifyUrl: string;
  commentary: string;
}

interface CoverFlowProps {
  albums: AlbumItem[];
  initialTrack?: AlbumTrackInfo | null;
  isReady?: boolean;
}

interface CoverFlowLayout {
  coverSize: number;
  perspective: number;
  wingOffset: number;
  wingStep: number;
  dragScale: number;
}

interface BBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

const SHOW_BACKGROUND_NUMBERS = false;
const WINDOW_RADIUS = 7;
const BG_WINDOW_RADIUS = 5;
const SVG_BASE_W = 1000;
const MEASURE_FONT_SIZE = 200;

const WEIGHT_STOPS = [100, 300, 500, 700, 900] as const;
const WIDTH_STOPS = [62, 77.75, 93.5, 109.25, 125] as const;

const FALLBACK_BBOX: BBox = {
  x: 8,
  y: -140,
  width: 204,
  height: 142,
};

function clamp(val: number, min: number, max: number) {
  return Math.max(min, Math.min(max, val));
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function smoothCosEase(t: number) {
  return 0.5 - 0.5 * Math.cos(clamp(t, 0, 1) * Math.PI);
}

function computeLayout(w: number, h: number): CoverFlowLayout {
  const coverSize = Math.round(clamp(Math.min(w * 0.34, h * 0.36), 148, 264));
  const perspective = Math.round(coverSize * 2.85);
  const wingOffset = Math.round(coverSize * 1.02);
  const wingStep = Math.round(coverSize * 0.27);
  const dragScale = Math.max(85, Math.round(coverSize * 0.55));

  return {
    coverSize,
    perspective,
    wingOffset,
    wingStep,
    dragScale,
  };
}

const DEFAULT_LAYOUT: CoverFlowLayout = computeLayout(1440, 900);

function interpolateBBox(stops: BBox[] | undefined, focus: number): BBox {
  if (!stops || stops.length !== WEIGHT_STOPS.length) {
    return FALLBACK_BBOX;
  }
  const scaled = clamp(focus, 0, 1) * (stops.length - 1);
  const low = Math.floor(scaled);
  const high = Math.min(stops.length - 1, low + 1);
  const frac = scaled - low;
  const a = stops[low];
  const b = stops[high];

  return {
    x: lerp(a.x, b.x, frac),
    y: lerp(a.y, b.y, frac),
    width: Math.max(1, lerp(a.width, b.width, frac)),
    height: Math.max(1, lerp(a.height, b.height, frac)),
  };
}

function measureTrueInkBBox(
  label: string,
  textEl: SVGTextElement,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  computedFontFamily: string
): BBox[] {
  const stops: BBox[] = [];
  const cw = canvas.width;
  const ch = canvas.height;
  const originX = 80;
  const baselineY = 250;

  const canvasStretchKeywords: CanvasFontStretch[] = [
    'ultra-condensed',
    'condensed',
    'normal',
    'expanded',
    'extra-expanded',
  ];

  textEl.textContent = label;

  for (let s = 0; s < WEIGHT_STOPS.length; s++) {
    const wght = WEIGHT_STOPS[s];
    const wdth = WIDTH_STOPS[s];

    textEl.style.fontWeight = String(wght);
    textEl.style.fontVariationSettings = `'wght' ${wght}, 'wdth' ${wdth}`;
    const svgRaw = textEl.getBBox();

    ctx.clearRect(0, 0, cw, ch);
    ctx.font = `${wght} ${MEASURE_FONT_SIZE}px ${computedFontFamily}`;
    if ('fontStretch' in ctx) {
      ctx.fontStretch = canvasStretchKeywords[s];
    }
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(label, originX, baselineY);

    const img = ctx.getImageData(0, 0, cw, ch).data;
    let minX = cw;
    let maxX = -1;
    let minY = ch;
    let maxY = -1;

    for (let y = 0; y < ch; y++) {
      const rowOffset = y * cw * 4;
      for (let x = 0; x < cw; x++) {
        if (img[rowOffset + x * 4 + 3] > 12) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    if (maxX >= minX && maxY >= minY) {
      const inkY = minY - baselineY;
      const inkHeight = Math.max(1, maxY - minY + 1);

      const canvasAdvance = Math.max(1, ctx.measureText(label).width);
      const leftFrac = clamp((minX - originX) / canvasAdvance, 0, 0.25);
      const rightFrac = clamp(
        (originX + canvasAdvance - (maxX + 1)) / canvasAdvance,
        0,
        0.25
      );

      const inkX = svgRaw.x + svgRaw.width * leftFrac;
      const inkWidth = Math.max(
        1,
        svgRaw.width * Math.max(0.4, 1 - leftFrac - rightFrac)
      );

      stops.push({
        x: inkX,
        y: inkY,
        width: inkWidth,
        height: inkHeight,
      });
    } else {
      stops.push({
        x: svgRaw.x,
        y: -140,
        width: Math.max(1, svgRaw.width),
        height: 142,
      });
    }
  }

  return stops;
}

function getCoverMetrics(
  distance: number,
  velocity: number,
  layout: CoverFlowLayout,
  reducedMotion: boolean
) {
  const absDist = Math.abs(distance);
  const dir = Math.sign(distance);

  const centerBlend =
    absDist < 1 ? Math.pow(Math.cos((absDist * Math.PI) / 2), 1.35) : 0;

  let x: number;
  if (absDist <= 1) {
    const smoothProgress =
      0.85 * absDist + 0.15 * Math.sin((absDist * Math.PI) / 2);
    x = dir * layout.wingOffset * smoothProgress;
  } else {
    x = dir * (layout.wingOffset + (absDist - 1) * layout.wingStep);
  }

  const z =
    110 * centerBlend +
    (-85 - Math.max(0, absDist - 1) * 14) * (1 - centerBlend);

  const baseAngle = -dir * 54 * (1 - centerBlend);
  const velocityTilt = reducedMotion
    ? 0
    : clamp(-velocity * 6, -8, 8) * (1 - centerBlend * 0.8);
  const rotateY = baseAngle + velocityTilt;

  const scale = 0.9 + centerBlend * 0.42;

  const zIndex = 500 - Math.round(absDist * 20);

  const brightness =
    centerBlend > 0
      ? 0.9 + 0.1 * centerBlend
      : clamp(0.9 - (absDist - 1) * 0.045, 0.58, 0.9);

  const dimOpacity = clamp(1 - brightness, 0, 0.7);
  const opacity = absDist > 6.5 ? clamp(1 - (absDist - 6.5) / 1.5, 0, 1) : 1;

  return {
    transform: `translate3d(${x.toFixed(2)}px, 0px, ${z.toFixed(2)}px) rotateY(${rotateY.toFixed(2)}deg) scale(${scale.toFixed(4)})`,
    zIndex,
    dimOpacity,
    opacity,
  };
}

function computeBackgroundStrip(
  pos: number,
  viewportW: number,
  total: number,
  startIdx: number,
  endIdx: number
) {
  const narrowW = viewportW * 0.1;
  const activeExtra = viewportW * 0.7;

  const leftEdgeBoost =
    total > 1 ? narrowW * smoothCosEase(clamp(1 - pos, 0, 1)) : 0;
  const rightEdgeBoost =
    total > 2
      ? narrowW * smoothCosEase(clamp(pos - (total - 2), 0, 1))
      : 0;

  const cameraX =
    total > 2 ? clamp(pos - 1, 0, total - 2) * narrowW : 0;

  const results: {
    id: number;
    screenX: number;
    width: number;
    focus: number;
  }[] = [];

  let cumX = 0;
  for (let i = 0; i <= endIdx; i++) {
    const t = clamp(1 - Math.abs(i - pos), 0, 1);
    const focus = smoothCosEase(t);
    let w = narrowW + activeExtra * focus;
    if (i === 0) w += leftEdgeBoost;
    if (i === total - 1) w += rightEdgeBoost;

    if (i >= startIdx) {
      results.push({
        id: i,
        screenX: cumX - cameraX,
        width: w,
        focus,
      });
    }
    cumX += w;
  }

  return results;
}

export default function CoverFlow({
  albums,
  initialTrack = null,
  isReady = true,
}: CoverFlowProps) {
  const totalCovers = albums.length;
  const containerRef = useRef<HTMLDivElement>(null);
  const measureTextRef = useRef<SVGTextElement>(null);
  const measureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const hasInteractedRef = useRef(false);
  const currentPlayingUrlRef = useRef<string | null>(null);
  const isReadyRef = useRef(isReady);
  const gestureRef = useRef<{
    startX: number;
    startY: number;
    pointerType: string;
    axis: 'none' | 'x' | 'y';
    captured: boolean;
  }>({
    startX: 0,
    startY: 0,
    pointerType: 'mouse',
    axis: 'none',
    captured: false,
  });

  const itemRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const frontDimRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const reflectionDimRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const bgSvgRefs = useRef<Map<number, SVGSVGElement>>(new Map());
  const bgTextRefs = useRef<Map<number, SVGTextElement>>(new Map());
  const bboxCacheRef = useRef<Map<string, BBox[]>>(new Map());

  const [centerIndex, setCenterIndex] = useState(0);
  const [layout, setLayout] = useState<CoverFlowLayout>(DEFAULT_LAYOUT);
  const [viewport, setViewport] = useState({ w: 1440, h: 900 });
  const [measureVersion, setMeasureVersion] = useState(0);
  const [failedImages, setFailedImages] = useState<Record<number, boolean>>({});
  const [trackMap, setTrackMap] = useState<Record<string, TrackEntry[]>>(() =>
    initialTrack?.tracks?.length && albums[0]?.spotifyUrl
      ? { [albums[0].spotifyUrl]: initialTrack.tracks }
      : {}
  );
  const [trackCursor, setTrackCursor] = useState<{
    albumId: number;
    index: number;
  }>({ albumId: 0, index: 0 });
  const [flippedId, setFlippedId] = useState<number | null>(null);

  const layoutRef = useRef<CoverFlowLayout>(DEFAULT_LAYOUT);
  const viewportRef = useRef({ w: 1440, h: 900 });
  const reducedMotionRef = useRef(false);
  const albumsRef = useRef<AlbumItem[]>(albums);
  const trackMapRef = useRef(trackMap);
  const activePreviewUrlRef = useRef<string | null>(null);
  const flippedIdRef = useRef<number | null>(null);

  useEffect(() => {
    albumsRef.current = albums;
  }, [albums]);

  useEffect(() => {
    trackMapRef.current = trackMap;
  }, [trackMap]);

  useEffect(() => {
    isReadyRef.current = isReady;
  }, [isReady]);

  useEffect(() => {
    flippedIdRef.current = flippedId;
  }, [flippedId]);

  const physicsRef = useRef({
    pos: 0,
    velocity: 0,
    mode: 'snap' as 'drag' | 'fluid' | 'snap',
    snapTarget: 0,
    lastWheelTime: 0,
    wheelAccum: 0,
    wheelStepLockUntil: 0,
    dragStartPos: 0,
    dragStartSnap: 0,
    lastPointerX: 0,
    pointerSamples: [] as { x: number; t: number }[],
    isDragging: false,
    activePointerId: null as number | null,
    lastFrameTime: 0,
    lastCenterIndex: 0,
  });

  useEffect(() => {
    const updateViewport = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      viewportRef.current = { w, h };
      setViewport({ w, h });

      const next = computeLayout(w, h);
      layoutRef.current = next;
      setLayout(next);
    };

    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    reducedMotionRef.current = motionQuery.matches;
    const onMotionChange = (e: MediaQueryListEvent) => {
      reducedMotionRef.current = e.matches;
    };
    motionQuery.addEventListener('change', onMotionChange);

    updateViewport();
    window.addEventListener('resize', updateViewport);
    return () => {
      window.removeEventListener('resize', updateViewport);
      motionQuery.removeEventListener('change', onMotionChange);
    };
  }, []);

  useEffect(() => {
    if (!SHOW_BACKGROUND_NUMBERS) return;
    let cancelled = false;

    const measureRange = async () => {
      if (typeof document === 'undefined' || !measureTextRef.current) return;
      if (document.fonts && document.fonts.ready) {
        await document.fonts.ready;
      }
      if (cancelled || !measureTextRef.current) return;

      const textEl = measureTextRef.current;
      const computedFontFamily =
        getComputedStyle(textEl).fontFamily || 'sans-serif';

      if (document.fonts && document.fonts.load) {
        await Promise.all([
          document.fonts.load(`100 ${MEASURE_FONT_SIZE}px ${computedFontFamily}`),
          document.fonts.load(`900 ${MEASURE_FONT_SIZE}px ${computedFontFamily}`),
        ]);
      }
      if (cancelled || !measureTextRef.current) return;

      if (!measureCanvasRef.current) {
        const c = document.createElement('canvas');
        c.width = 960;
        c.height = 340;
        measureCanvasRef.current = c;
      }
      const canvas = measureCanvasRef.current;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;

      const list = albumsRef.current;
      const bgStart = Math.max(0, centerIndex - BG_WINDOW_RADIUS);
      const bgEnd = Math.min(list.length - 1, centerIndex + BG_WINDOW_RADIUS);

      let added = false;
      for (let i = bgStart; i <= bgEnd; i++) {
        const label = list[i].label;
        if (bboxCacheRef.current.has(label)) continue;

        const stops = measureTrueInkBBox(
          label,
          textEl,
          canvas,
          ctx,
          computedFontFamily
        );
        bboxCacheRef.current.set(label, stops);
        added = true;
      }

      if (added && !cancelled) {
        setMeasureVersion((v) => v + 1);
      }
    };

    measureRange();
    return () => {
      cancelled = true;
    };
  }, [centerIndex, totalCovers]);

  useEffect(() => {
    if (totalCovers === 0) return;
    let rafId = 0;

    const applyAll = (pos: number, velocity: number) => {
      const currentLayout = layoutRef.current;
      const currentViewport = viewportRef.current;
      const reduced = reducedMotionRef.current;
      const list = albumsRef.current;

      itemRefs.current.forEach((el, idx) => {
        const metrics = getCoverMetrics(
          idx - pos,
          velocity,
          currentLayout,
          reduced
        );
        el.style.transform = metrics.transform;
        el.style.zIndex = String(metrics.zIndex);
        el.style.opacity =
          metrics.opacity < 0.999 ? String(metrics.opacity) : '';

        const dimStr =
          metrics.dimOpacity > 0.001 ? metrics.dimOpacity.toFixed(3) : '0';
        const frontDim = frontDimRefs.current.get(idx);
        if (frontDim) frontDim.style.opacity = dimStr;
        const reflDim = reflectionDimRefs.current.get(idx);
        if (reflDim) reflDim.style.opacity = dimStr;
      });

      if (!SHOW_BACKGROUND_NUMBERS) return;

      const rounded = clamp(Math.round(pos), 0, list.length - 1);
      const bgStart = Math.max(0, rounded - BG_WINDOW_RADIUS);
      const bgEnd = Math.min(list.length - 1, rounded + BG_WINDOW_RADIUS);
      const strip = computeBackgroundStrip(
        pos,
        currentViewport.w,
        list.length,
        bgStart,
        bgEnd
      );

      for (const item of strip) {
        const svg = bgSvgRefs.current.get(item.id);
        const text = bgTextRefs.current.get(item.id);
        if (!svg || !text) continue;

        const wght = Math.round(lerp(100, 900, item.focus));
        const wdth = Number(lerp(62, 125, item.focus).toFixed(1));
        const stops = bboxCacheRef.current.get(list[item.id].label);
        const bbox = interpolateBBox(stops, item.focus);

        svg.setAttribute(
          'viewBox',
          `${bbox.x.toFixed(2)} ${bbox.y.toFixed(2)} ${bbox.width.toFixed(2)} ${bbox.height.toFixed(2)}`
        );
        svg.style.transform = `translate3d(${item.screenX.toFixed(2)}px, 0px, 0px) scale(${(item.width / SVG_BASE_W).toFixed(5)}, 1)`;

        text.style.fontWeight = String(wght);
        text.style.fontVariationSettings = `'wght' ${wght}, 'wdth' ${wdth}`;

        const shade = Math.round(lerp(36, 78, item.focus));
        text.style.fill = `rgb(${shade}, ${shade}, ${shade + 4})`;
      }
    };

    const tick = (now: number) => {
      const p = physicsRef.current;
      const maxIndex = Math.max(0, albumsRef.current.length - 1);

      if (p.lastFrameTime === 0) {
        p.lastFrameTime = now;
      }
      const rawDt = (now - p.lastFrameTime) / 16.6667;
      const dt = Math.min(Math.max(rawDt, 0.2), 2.5);
      p.lastFrameTime = now;

      if (!p.isDragging) {
        if (p.mode === 'fluid') {
          p.pos += p.velocity * dt;
          p.velocity *= Math.pow(0.925, dt);

          if (p.pos < 0) {
            p.pos = 0;
            p.velocity = 0;
            p.snapTarget = 0;
            p.mode = 'snap';
          } else if (p.pos > maxIndex) {
            p.pos = maxIndex;
            p.velocity = 0;
            p.snapTarget = maxIndex;
            p.mode = 'snap';
          } else if (Math.abs(p.velocity) < 0.042) {
            p.snapTarget = clamp(
              Math.round(p.pos + p.velocity * 2.5),
              0,
              maxIndex
            );
            p.mode = 'snap';
          }
        }

        if (p.mode === 'snap') {
          const stiffness = reducedMotionRef.current ? 0.36 : 0.21;
          const damping = reducedMotionRef.current ? 0.45 : 0.64;
          const displacement = p.snapTarget - p.pos;
          p.velocity =
            (p.velocity + displacement * stiffness * dt) * Math.pow(damping, dt);
          p.pos += p.velocity * dt;

          if (Math.abs(displacement) < 0.0012 && Math.abs(p.velocity) < 0.0012) {
            p.pos = p.snapTarget;
            p.velocity = 0;
          }
        }
      }

      const roundedCenter = clamp(Math.round(p.pos), 0, maxIndex);
      if (roundedCenter !== p.lastCenterIndex) {
        p.lastCenterIndex = roundedCenter;
        setCenterIndex(roundedCenter);
      }

      applyAll(p.pos, p.velocity);
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [totalCovers]);

  useLayoutEffect(() => {
    if (totalCovers === 0) return;
    const p = physicsRef.current;
    const currentLayout = layoutRef.current;
    const currentViewport = viewportRef.current;
    const reduced = reducedMotionRef.current;
    const list = albumsRef.current;

    itemRefs.current.forEach((el, idx) => {
      const metrics = getCoverMetrics(
        idx - p.pos,
        p.velocity,
        currentLayout,
        reduced
      );
      el.style.transform = metrics.transform;
      el.style.zIndex = String(metrics.zIndex);
      el.style.opacity = metrics.opacity < 0.999 ? String(metrics.opacity) : '';

      const dimStr =
        metrics.dimOpacity > 0.001 ? metrics.dimOpacity.toFixed(3) : '0';
      const frontDim = frontDimRefs.current.get(idx);
      if (frontDim) frontDim.style.opacity = dimStr;
      const reflDim = reflectionDimRefs.current.get(idx);
      if (reflDim) reflDim.style.opacity = dimStr;
    });

    if (!SHOW_BACKGROUND_NUMBERS) return;

    const bgStart = Math.max(0, centerIndex - BG_WINDOW_RADIUS);
    const bgEnd = Math.min(list.length - 1, centerIndex + BG_WINDOW_RADIUS);
    const strip = computeBackgroundStrip(
      p.pos,
      currentViewport.w,
      list.length,
      bgStart,
      bgEnd
    );

    for (const item of strip) {
      const svg = bgSvgRefs.current.get(item.id);
      const text = bgTextRefs.current.get(item.id);
      if (!svg || !text) continue;

      const wght = Math.round(lerp(100, 900, item.focus));
      const wdth = Number(lerp(62, 125, item.focus).toFixed(1));
      const stops = bboxCacheRef.current.get(list[item.id].label);
      const bbox = interpolateBBox(stops, item.focus);

      svg.setAttribute(
        'viewBox',
        `${bbox.x.toFixed(2)} ${bbox.y.toFixed(2)} ${bbox.width.toFixed(2)} ${bbox.height.toFixed(2)}`
      );
      svg.style.transform = `translate3d(${item.screenX.toFixed(2)}px, 0px, 0px) scale(${(item.width / SVG_BASE_W).toFixed(5)}, 1)`;

      text.style.fontWeight = String(wght);
      text.style.fontVariationSettings = `'wght' ${wght}, 'wdth' ${wdth}`;

      const shade = Math.round(lerp(36, 78, item.focus));
      text.style.fill = `rgb(${shade}, ${shade}, ${shade + 4})`;
    }
  }, [centerIndex, layout, viewport, measureVersion, totalCovers]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || totalCovers === 0) return;
    const maxIndex = totalCovers - 1;

    const markInteracted = () => {
      hasInteractedRef.current = true;
    };

    const handleWheel = (e: WheelEvent) => {
      if (!isReadyRef.current) {
        e.preventDefault();
        return;
      }

      const canScrollVertically = el.scrollHeight > el.clientHeight + 2;
      const isVerticalDominant =
        !e.shiftKey && Math.abs(e.deltaY) >= Math.abs(e.deltaX);

      if (canScrollVertically && isVerticalDominant) {
        return;
      }

      e.preventDefault();
      markInteracted();
      const p = physicsRef.current;
      const now = performance.now();

      let delta =
        Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (e.deltaMode === 1) delta *= 32;
      else if (e.deltaMode === 2) delta *= window.innerWidth;

      if (Math.abs(delta) < 0.5) return;

      if (flippedIdRef.current !== null) {
        flippedIdRef.current = null;
        setFlippedId(null);
      }

      const dt = now - p.lastWheelTime;
      p.lastWheelTime = now;

      const absDelta = Math.abs(delta);
      const isRapidBurst =
        dt < 48 && (absDelta > 40 || Math.abs(p.velocity) > 0.14);
      const isHighImpulse = absDelta > 130 && dt < 80;

      if (isRapidBurst || isHighImpulse) {
        p.mode = 'fluid';
        p.wheelAccum = 0;
        const impulse = clamp(delta * 0.003, -0.85, 0.85);
        p.velocity = clamp(p.velocity * 0.65 + impulse, -2.2, 2.2);
      } else {
        if (p.mode === 'fluid' && Math.abs(p.velocity) > 0.25) {
          p.velocity = clamp(p.velocity + delta * 0.002, -2.2, 2.2);
          return;
        }

        if (dt > 180) {
          p.wheelAccum = 0;
        }

        p.wheelAccum += delta;

        if (now < p.wheelStepLockUntil && Math.abs(p.wheelAccum) < 130) {
          return;
        }

        if (Math.abs(p.wheelAccum) >= 24) {
          const dir = Math.sign(p.wheelAccum);
          p.wheelAccum = 0;
          const base = p.mode === 'snap' ? p.snapTarget : Math.round(p.pos);
          p.snapTarget = clamp(base + dir, 0, maxIndex);
          p.mode = 'snap';
          p.velocity += dir * 0.06;
          p.wheelStepLockUntil = now + 95;
        }
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isReadyRef.current) return;
      const p = physicsRef.current;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault();
        markInteracted();
        if (flippedIdRef.current !== null) {
          flippedIdRef.current = null;
          setFlippedId(null);
        }
        const step = e.key === 'PageDown' ? 5 : 1;
        const base = p.mode === 'snap' ? p.snapTarget : Math.round(p.pos);
        p.snapTarget = clamp(base + step, 0, maxIndex);
        p.mode = 'snap';
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        markInteracted();
        if (flippedIdRef.current !== null) {
          flippedIdRef.current = null;
          setFlippedId(null);
        }
        const step = e.key === 'PageUp' ? 5 : 1;
        const base = p.mode === 'snap' ? p.snapTarget : Math.round(p.pos);
        p.snapTarget = clamp(base - step, 0, maxIndex);
        p.mode = 'snap';
      } else if (e.key === 'Home') {
        e.preventDefault();
        markInteracted();
        if (flippedIdRef.current !== null) {
          flippedIdRef.current = null;
          setFlippedId(null);
        }
        p.snapTarget = 0;
        p.mode = 'snap';
      } else if (e.key === 'End') {
        e.preventDefault();
        markInteracted();
        if (flippedIdRef.current !== null) {
          flippedIdRef.current = null;
          setFlippedId(null);
        }
        p.snapTarget = maxIndex;
        p.mode = 'snap';
      } else if (e.key === 'Enter' || e.key === ' ') {
        const active = albumsRef.current[p.lastCenterIndex];
        if (active?.commentary) {
          e.preventDefault();
          markInteracted();
          setFlippedId((prev) => (prev === active.id ? null : active.id));
        }
      }
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      el.removeEventListener('wheel', handleWheel);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [totalCovers]);

  useEffect(() => {
    const list = albumsRef.current;
    if (list.length === 0) return;

    let cancelled = false;
    const indicesToLoad = [centerIndex, centerIndex + 1, centerIndex - 1].filter(
      (idx) => idx >= 0 && idx < list.length
    );

    const timer = window.setTimeout(() => {
      indicesToLoad.forEach(async (idx) => {
        const spotifyUrl = list[idx]?.spotifyUrl;
        if (!spotifyUrl || trackMapRef.current[spotifyUrl]) return;

        try {
          const res = await fetch(
            `/api/album-track?url=${encodeURIComponent(spotifyUrl)}`
          );
          if (!res.ok) return;
          const data = (await res.json()) as {
            tracks?: TrackEntry[];
          };
          if (cancelled || !Array.isArray(data?.tracks) || data.tracks.length === 0) {
            return;
          }
          const tracks = data.tracks;
          setTrackMap((prev) =>
            prev[spotifyUrl] ? prev : { ...prev, [spotifyUrl]: tracks }
          );
        } catch {
          // Silently ignore transient network failures
        }
      });
    }, 120);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [centerIndex, totalCovers]);

  const activeSpotifyUrl = albums[centerIndex]?.spotifyUrl ?? '';
  const activeTracks = useMemo(
    () => (activeSpotifyUrl ? trackMap[activeSpotifyUrl] ?? [] : []),
    [activeSpotifyUrl, trackMap]
  );
  const currentTrackIdx =
    trackCursor.albumId === centerIndex &&
    trackCursor.index < activeTracks.length
      ? trackCursor.index
      : 0;
  const currentTrack = activeTracks[currentTrackIdx] ?? activeTracks[0] ?? null;
  const activePreviewUrl = currentTrack?.previewUrl ?? null;

  useEffect(() => {
    activePreviewUrlRef.current = activePreviewUrl;
  }, [activePreviewUrl]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const timer = window.setTimeout(() => {
      if (!hasInteractedRef.current) return;

      if (!activePreviewUrl) {
        audio.pause();
        currentPlayingUrlRef.current = null;
        return;
      }

      if (currentPlayingUrlRef.current !== activePreviewUrl) {
        audio.src = activePreviewUrl;
        audio.volume = 0.55;
        currentPlayingUrlRef.current = activePreviewUrl;
      }

      if (audio.paused) {
        audio.play().catch(() => {});
      }
    }, 180);

    return () => {
      window.clearTimeout(timer);
    };
  }, [activePreviewUrl]);

  useEffect(() => {
    const audio = audioRef.current;
    return () => {
      if (audio) {
        audio.pause();
        audio.removeAttribute('src');
      }
    };
  }, []);

  const handleAudioEnded = () => {
    if (activeTracks.length === 0) return;

    let nextIdx = (currentTrackIdx + 1) % activeTracks.length;
    if (activeTracks.length > 1) {
      for (let offset = 1; offset <= activeTracks.length; offset++) {
        const candidateIdx = (currentTrackIdx + offset) % activeTracks.length;
        if (activeTracks[candidateIdx]?.previewUrl) {
          nextIdx = candidateIdx;
          break;
        }
      }
    }

    if (nextIdx === currentTrackIdx) {
      const audio = audioRef.current;
      if (audio && activePreviewUrl) {
        audio.currentTime = 0;
        audio.play().catch(() => {});
      }
      return;
    }

    setTrackCursor({ albumId: centerIndex, index: nextIdx });
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isReadyRef.current) return;
    hasInteractedRef.current = true;
    const audio = audioRef.current;
    const preview = activePreviewUrlRef.current;
    if (audio && preview && audio.paused) {
      if (currentPlayingUrlRef.current !== preview) {
        audio.src = preview;
        audio.volume = 0.55;
        currentPlayingUrlRef.current = preview;
      }
      audio.play().catch(() => {});
    }

    gestureRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      pointerType: e.pointerType,
      axis: 'none',
      captured: false,
    };

    const p = physicsRef.current;
    p.isDragging = true;
    p.activePointerId = e.pointerId;
    p.mode = 'drag';
    p.velocity = 0;
    p.lastPointerX = e.clientX;
    p.dragStartPos = p.pos;
    p.dragStartSnap = Math.round(p.pos);
    p.pointerSamples = [{ x: e.clientX, t: performance.now() }];
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = physicsRef.current;
    if (!p.isDragging || p.activePointerId !== e.pointerId) return;

    const g = gestureRef.current;
    if (g.axis === 'y') return;

    const maxIndex = Math.max(0, totalCovers - 1);
    const now = performance.now();

    if (g.axis === 'none') {
      const totalDx = Math.abs(e.clientX - g.startX);
      const totalDy = Math.abs(e.clientY - g.startY);
      if (totalDx < 5 && totalDy < 5) return;

      if (g.pointerType !== 'mouse' && totalDy > totalDx * 1.1) {
        g.axis = 'y';
        p.isDragging = false;
        p.activePointerId = null;
        p.mode = 'snap';
        p.snapTarget = clamp(Math.round(p.pos), 0, maxIndex);
        return;
      }

      g.axis = 'x';
      p.lastPointerX = e.clientX;
      p.pointerSamples = [{ x: e.clientX, t: now }];
      if (!g.captured) {
        g.captured = true;
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // Ignore if pointer capture is unavailable
        }
      }
      if (flippedIdRef.current !== null) {
        flippedIdRef.current = null;
        setFlippedId(null);
      }
      return;
    }

    if (flippedIdRef.current !== null) {
      flippedIdRef.current = null;
      setFlippedId(null);
    }

    const dx = e.clientX - p.lastPointerX;
    p.lastPointerX = e.clientX;

    const dragScale = layoutRef.current.dragScale;
    let nextPos = p.pos - dx / dragScale;

    if (nextPos < 0) {
      nextPos = nextPos * 0.25;
    } else if (nextPos > maxIndex) {
      nextPos = maxIndex + (nextPos - maxIndex) * 0.25;
    }

    p.velocity = clamp(-dx / dragScale, -1.5, 1.5);
    p.pos = nextPos;

    p.pointerSamples.push({ x: e.clientX, t: now });
    while (p.pointerSamples.length > 2 && now - p.pointerSamples[0].t > 90) {
      p.pointerSamples.shift();
    }
  };

  const finishDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = physicsRef.current;
    if (!p.isDragging || p.activePointerId !== e.pointerId) return;

    const wasAxisX = gestureRef.current.axis === 'x';
    p.isDragging = false;
    p.activePointerId = null;
    gestureRef.current.axis = 'none';
    gestureRef.current.captured = false;

    if (!wasAxisX) {
      p.mode = 'snap';
      p.velocity = 0;
      p.snapTarget = clamp(Math.round(p.pos), 0, Math.max(0, totalCovers - 1));
      return;
    }

    const maxIndex = Math.max(0, totalCovers - 1);
    const now = performance.now();
    const recentSamples = p.pointerSamples.filter((s) => now - s.t <= 100);
    let releaseVelocity = 0;

    if (recentSamples.length >= 2) {
      const first = recentSamples[0];
      const last = recentSamples[recentSamples.length - 1];
      const dtMs = Math.max(last.t - first.t, 8);
      const dx = last.x - first.x;
      const dragScale = layoutRef.current.dragScale;
      releaseVelocity = ((-dx / dragScale) / dtMs) * 16.6667;
    }

    const absVel = Math.abs(releaseVelocity);
    const dragDelta = p.pos - p.dragStartPos;

    if (absVel > 0.16 && p.pos >= 0 && p.pos <= maxIndex) {
      p.mode = 'fluid';
      p.velocity = clamp(releaseVelocity * 1.15, -2.6, 2.6);
    } else {
      p.mode = 'snap';
      p.velocity = clamp(releaseVelocity * 0.5, -0.35, 0.35);

      if (Math.abs(dragDelta) > 0.16 && Math.abs(dragDelta) < 0.55) {
        p.snapTarget = clamp(
          p.dragStartSnap + Math.sign(dragDelta),
          0,
          maxIndex
        );
      } else {
        p.snapTarget = clamp(Math.round(p.pos), 0, maxIndex);
      }
    }
  };

  const handleCoverClick = useCallback(
    (idx: number) => {
      if (!isReadyRef.current) return;
      const p = physicsRef.current;
      if (Math.abs(p.pos - p.dragStartPos) > 0.08) return;

      const isCentered =
        idx === p.lastCenterIndex && Math.abs(p.pos - idx) < 0.22;
      if (isCentered) {
        const cover = albumsRef.current[idx];
        if (!cover?.commentary) return;
        setFlippedId((prev) => (prev === idx ? null : idx));
        return;
      }

      if (flippedIdRef.current !== null) {
        flippedIdRef.current = null;
        setFlippedId(null);
      }
      p.snapTarget = idx;
      p.mode = 'snap';
    },
    []
  );

  const handleImageError = useCallback((id: number) => {
    setFailedImages((prev) => (prev[id] ? prev : { ...prev, [id]: true }));
  }, []);

  const registerItemRef = useCallback(
    (id: number, el: HTMLDivElement | null) => {
      if (el) {
        itemRefs.current.set(id, el);
      } else {
        itemRefs.current.delete(id);
      }
    },
    []
  );

  const registerFrontDimRef = useCallback(
    (id: number, el: HTMLDivElement | null) => {
      if (el) {
        frontDimRefs.current.set(id, el);
      } else {
        frontDimRefs.current.delete(id);
      }
    },
    []
  );

  const registerReflectionDimRef = useCallback(
    (id: number, el: HTMLDivElement | null) => {
      if (el) {
        reflectionDimRefs.current.set(id, el);
      } else {
        reflectionDimRefs.current.delete(id);
      }
    },
    []
  );

  const visibleCovers = useMemo(() => {
    if (totalCovers === 0) return [];
    const startIdx = Math.max(0, centerIndex - WINDOW_RADIUS);
    const endIdx = Math.min(totalCovers - 1, centerIndex + WINDOW_RADIUS);
    return albums.slice(startIdx, endIdx + 1);
  }, [albums, centerIndex, totalCovers]);

  const bgStrip = useMemo(() => {
    if (totalCovers === 0) return [];
    const bgStart = Math.max(0, centerIndex - BG_WINDOW_RADIUS);
    const bgEnd = Math.min(totalCovers - 1, centerIndex + BG_WINDOW_RADIUS);
    return computeBackgroundStrip(
      centerIndex,
      viewport.w,
      totalCovers,
      bgStart,
      bgEnd
    );
  }, [centerIndex, viewport.w, totalCovers]);

  const activeAlbum = albums[centerIndex];
  const activeTrackTitle = currentTrack?.trackTitle ?? '';
  const imageSizes = `${Math.round(layout.coverSize * 1.4)}px`;

  return (
    <main
      ref={containerRef}
      role="region"
      aria-roledescription="carousel"
      aria-label="synthavard Album Cover Flow"
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      className="relative h-[calc(var(--vh,1vh)*100)] w-screen overflow-y-auto overflow-x-clip no-scrollbar bg-black flex flex-col select-none touch-pan-y outline-none cursor-grab active:cursor-grabbing rounded-none"
    >
      <audio
        ref={audioRef}
        onEnded={handleAudioEnded}
        preload="none"
        aria-hidden="true"
        className="hidden"
      />
      {/* Offscreen SVG glyph measurer */}
      {SHOW_BACKGROUND_NUMBERS && (
        <svg
          aria-hidden="true"
          width="960"
          height="340"
          className="fixed -top-[9999px] -left-[9999px] pointer-events-none opacity-0"
        >
          <text
            ref={measureTextRef}
            x="0"
            y="0"
            fontSize={MEASURE_FONT_SIZE}
            style={{
              fontFamily: 'var(--font-archivo), sans-serif',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            01
          </text>
        </svg>
      )}

      {/* Background kinetic stretched Archivo index numbers */}
      {SHOW_BACKGROUND_NUMBERS && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 overflow-hidden z-0"
        >
          {bgStrip.map((item) => {
          const wght = Math.round(lerp(100, 900, item.focus));
          const wdth = Number(lerp(62, 125, item.focus).toFixed(1));
          const shade = Math.round(lerp(36, 78, item.focus));

          return (
            <svg
              key={item.id}
              ref={(el) => {
                if (el) {
                  bgSvgRefs.current.set(item.id, el);
                } else {
                  bgSvgRefs.current.delete(item.id);
                }
              }}
              width={SVG_BASE_W}
              height={viewport.h}
              viewBox={`${FALLBACK_BBOX.x} ${FALLBACK_BBOX.y} ${FALLBACK_BBOX.width} ${FALLBACK_BBOX.height}`}
              preserveAspectRatio="none"
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                transformOrigin: '0 0',
                transform: `translate3d(${item.screenX.toFixed(2)}px, 0px, 0px) scale(${(item.width / SVG_BASE_W).toFixed(5)}, 1)`,
                willChange: 'transform',
              }}
            >
              <text
                ref={(el) => {
                  if (el) {
                    bgTextRefs.current.set(item.id, el);
                  } else {
                    bgTextRefs.current.delete(item.id);
                  }
                }}
                x="0"
                y="0"
                fontSize={MEASURE_FONT_SIZE}
                style={{
                  fontFamily: 'var(--font-archivo), sans-serif',
                  fontWeight: wght,
                  fontVariationSettings: `'wght' ${wght}, 'wdth' ${wdth}`,
                  fontVariantNumeric: 'tabular-nums',
                  fill: `rgb(${shade}, ${shade}, ${shade + 4})`,
                }}
              >
                {albums[item.id].label}
              </text>
            </svg>
          );
        })}
        </div>
      )}

      {/* Normal-flow scrollable column wrapper so narrow landscape viewports scroll smoothly without clipping or visible scrollbars */}
      <div className="my-auto w-full flex flex-col items-center px-6 pt-8 pb-8">
        {/* Foreground 3D Apple Cover Flow */}
        <div
          className="relative z-10 flex items-center justify-center shrink-0"
          style={{
            width: layout.coverSize,
            height: layout.coverSize,
            perspective: `${layout.perspective}px`,
            marginTop: `${Math.round(layout.coverSize * 0.16)}px`,
            marginBottom: `${Math.round(layout.coverSize * 0.36)}px`,
          }}
        >
          {visibleCovers.map((cover) => {
            const initialMetrics = getCoverMetrics(
              cover.id - centerIndex,
              0,
              layout,
              false
            );
            const isPriority = Math.abs(cover.id - centerIndex) <= 2;
            const isFailed = Boolean(failedImages[cover.id]);
            const isFlipped = flippedId === cover.id;
            const isCenteredWithNotes =
              cover.id === centerIndex && Boolean(cover.commentary);

            return (
              <FlipAlbumCard
                key={cover.id}
                cover={cover}
                coverSize={layout.coverSize}
                perspective={layout.perspective}
                imageSizes={imageSizes}
                isPriority={isPriority}
                isFailed={isFailed}
                isFlipped={isFlipped}
                isCenteredWithNotes={isCenteredWithNotes}
                initialTransform={initialMetrics.transform}
                initialZIndex={initialMetrics.zIndex}
                initialOpacity={initialMetrics.opacity}
                initialDimOpacity={initialMetrics.dimOpacity}
                onImageError={handleImageError}
                onClick={handleCoverClick}
                registerItemRef={registerItemRef}
                registerFrontDimRef={registerFrontDimRef}
                registerReflectionDimRef={registerReflectionDimRef}
              />
            );
          })}
        </div>

        {/* Fixed-height minimalist active album metadata (zero layout shift across all albums) */}
        {activeAlbum && (
          <div
            aria-live="polite"
            className="pointer-events-none relative z-20 flex flex-col items-center text-center w-full"
          >
            <p className="text-base sm:text-lg font-semibold tracking-tight text-white max-w-md truncate h-6 sm:h-7 leading-6 sm:leading-7">
              {activeAlbum.title}
            </p>
            <p className="text-xs sm:text-sm text-neutral-400 mt-0.5 max-w-sm truncate h-4 sm:h-5 leading-4 sm:leading-5">
              {activeAlbum.artist}
            </p>
            <p
              className="mt-2.5 h-5 sm:h-6 text-sm sm:text-[15px] font-medium tracking-tight text-white max-w-md truncate leading-5 sm:leading-6"
              style={{ fontFamily: 'var(--font-archivo), sans-serif' }}
            >
              {activeTrackTitle || '\u00A0'}
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
