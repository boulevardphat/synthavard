'use client';

import React, { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import Image from 'next/image';

import type { AlbumItem } from '@/components/CoverFlow';
import paperBg from '../public/paper.png';

const directImageLoader = ({ src }: { src: string }) => src;

function clamp(val: number, min: number, max: number) {
  return Math.max(min, Math.min(max, val));
}

interface FlipAlbumCardProps {
  cover: AlbumItem;
  coverSize: number;
  perspective: number;
  imageSizes: string;
  isPriority: boolean;
  isFailed: boolean;
  isFlipped: boolean;
  isCenteredWithNotes: boolean;
  initialTransform: string;
  initialZIndex: number;
  initialOpacity: number;
  initialDimOpacity: number;
  onImageError: (id: number) => void;
  onClick: (id: number) => void;
  registerItemRef: (id: number, el: HTMLDivElement | null) => void;
  registerFrontDimRef: (id: number, el: HTMLDivElement | null) => void;
  registerReflectionDimRef: (id: number, el: HTMLDivElement | null) => void;
}

export default function FlipAlbumCard({
  cover,
  coverSize,
  perspective,
  imageSizes,
  isPriority,
  isFailed,
  isFlipped,
  isCenteredWithNotes,
  initialTransform,
  initialZIndex,
  initialOpacity,
  initialDimOpacity,
  onImageError,
  onClick,
  registerItemRef,
  registerFrontDimRef,
  registerReflectionDimRef,
}: FlipAlbumCardProps) {
  const slabRef = useRef<HTMLDivElement>(null);
  const reflSlabRef = useRef<HTMLDivElement>(null);
  const frontShadeRef = useRef<HTMLDivElement>(null);
  const backShadeRef = useRef<HTMLDivElement>(null);
  const contactShadowRef = useRef<HTMLDivElement>(null);

  const springRef = useRef({
    p: isFlipped ? 1 : 0,
    v: 0,
    target: isFlipped ? 1 : 0,
  });

  const flipPerspective = Math.max(
    320,
    Math.min(perspective, Math.round(coverSize * 2.15))
  );
  const slabDepth = Math.max(14, Math.round(coverSize * 0.068));
  const halfD = slabDepth / 2;
  const zLift = Math.round(coverSize * 0.3);
  const zRest = Math.round(coverSize * 0.08);
  const reflPadX = Math.round(coverSize * 0.36);

  const applyFlipFrame = useCallback(
    (rawP: number) => {
      const p = clamp(rawP, -0.1, 1.1);
      const pClamped = clamp(p, 0, 1);
      const arc = Math.sin(pClamped * Math.PI);

      const ry = p * 180;
      const rx = arc * 13;
      const z = arc * zLift + pClamped * zRest;

      if (slabRef.current) {
        slabRef.current.style.transform = `perspective(${flipPerspective}px) translate3d(0px, 0px, ${z.toFixed(2)}px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg)`;
      }
      if (reflSlabRef.current) {
        reflSlabRef.current.style.transform = `perspective(${flipPerspective}px) translate3d(0px, 0px, ${z.toFixed(2)}px) rotateX(${(-rx).toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg)`;
      }
      if (frontShadeRef.current) {
        frontShadeRef.current.style.opacity = clamp(pClamped * 1.15, 0, 0.56).toFixed(3);
      }
      if (backShadeRef.current) {
        backShadeRef.current.style.opacity = clamp((1 - pClamped) * 1.15, 0, 0.56).toFixed(3);
      }
      if (contactShadowRef.current) {
        const scaleX = 1 - arc * 0.68 - pClamped * 0.08;
        const opacity = 0.68 - arc * 0.3 + pClamped * 0.16;
        contactShadowRef.current.style.transform = `rotateX(70deg) scaleX(${scaleX.toFixed(3)})`;
        contactShadowRef.current.style.opacity = opacity.toFixed(3);
      }
    },
    [flipPerspective, zLift, zRest]
  );

  useLayoutEffect(() => {
    applyFlipFrame(springRef.current.p);
  }, [applyFlipFrame]);

  useEffect(() => {
    const s = springRef.current;
    s.target = isFlipped ? 1 : 0;

    if (Math.abs(s.target - s.p) < 0.0005 && Math.abs(s.v) < 0.0005) {
      s.p = s.target;
      s.v = 0;
      applyFlipFrame(s.p);
      return;
    }

    let rafId = 0;
    let lastTime = performance.now();
    const stiffness = 165;
    const damping = 19.5;

    const step = (now: number) => {
      const dt = Math.min(Math.max((now - lastTime) / 1000, 0.001), 0.032);
      lastTime = now;

      const accel = (s.target - s.p) * stiffness - s.v * damping;
      s.v += accel * dt;
      s.p += s.v * dt;

      if (Math.abs(s.target - s.p) < 0.0008 && Math.abs(s.v) < 0.0008) {
        s.p = s.target;
        s.v = 0;
        applyFlipFrame(s.p);
        return;
      }

      applyFlipFrame(s.p);
      rafId = requestAnimationFrame(step);
    };

    rafId = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(rafId);
    };
  }, [isFlipped, applyFlipFrame]);

  return (
    <div
      ref={(el) => registerItemRef(cover.id, el)}
      onClick={() => onClick(cover.id)}
      style={{
        width: coverSize,
        height: coverSize,
        transform: initialTransform,
        zIndex: initialZIndex,
        opacity: initialOpacity < 0.999 ? initialOpacity : undefined,
      }}
      className={`absolute will-change-transform origin-center ${isCenteredWithNotes ? 'cursor-pointer' : ''}`}
    >
      {/* 3D Volumetric Album Slab (6-sided cuboid with self-contained perspective) */}
      <div
        ref={slabRef}
        style={{
          transformStyle: 'preserve-3d',
        }}
        className="relative w-full h-full rounded-none"
      >
        {/* Front Face: Album Artwork (+halfD) */}
        <div
          style={{
            backfaceVisibility: 'hidden',
            WebkitBackfaceVisibility: 'hidden',
            transform: `translateZ(${halfD}px)`,
            boxShadow: '0 16px 38px rgba(0, 0, 0, 0.82)',
          }}
          className="absolute inset-0 w-full h-full bg-neutral-900 rounded-none overflow-hidden"
        >
          {!isFailed ? (
            <Image
              loader={directImageLoader}
              src={cover.imageUrl}
              alt={`${cover.title} — ${cover.artist}`}
              fill
              sizes={imageSizes}
              priority={isPriority}
              referrerPolicy="no-referrer"
              draggable={false}
              onError={() => onImageError(cover.id)}
              className="object-cover select-none pointer-events-none"
            />
          ) : (
            <div className="w-full h-full bg-neutral-900 flex flex-col items-center justify-center p-4 text-center">
              <span className="text-xs font-medium text-neutral-300 line-clamp-2">
                {cover.title}
              </span>
              <span className="text-[11px] text-neutral-500 mt-1 line-clamp-1">
                {cover.artist}
              </span>
            </div>
          )}

          {/* Wing depth dimming overlay */}
          <div
            ref={(el) => registerFrontDimRef(cover.id, el)}
            aria-hidden="true"
            style={{ opacity: initialDimOpacity }}
            className="pointer-events-none absolute inset-0 bg-black"
          />

          {/* Dynamic 3D rotation studio shading */}
          <div
            ref={frontShadeRef}
            aria-hidden="true"
            style={{ opacity: 0 }}
            className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/80 via-black/45 to-black/15"
          />
        </div>

        {/* Back Face: Lined Paper & Typewriter Notes (-halfD, rotated 180deg) */}
        <div
          style={{
            backfaceVisibility: 'hidden',
            WebkitBackfaceVisibility: 'hidden',
            transform: `rotateY(180deg) translateZ(${halfD}px)`,
            boxShadow: '0 22px 52px rgba(0, 0, 0, 0.9)',
          }}
          className="absolute inset-0 w-full h-full bg-[#faf8ee] rounded-none overflow-hidden flex items-center justify-center p-4 sm:p-6"
        >
          <Image
            src={paperBg}
            alt=""
            fill
            sizes={imageSizes}
            referrerPolicy="no-referrer"
            draggable={false}
            className="object-cover select-none pointer-events-none"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            style={{
              boxShadow: 'inset 0 0 24px rgba(0, 0, 0, 0.1)',
            }}
          />
          <div className="relative z-10 w-full max-h-full overflow-y-auto no-scrollbar pointer-events-none">
            <p
              className="text-[11px] sm:text-[13px] leading-[1.6] text-[#1c1b19] text-left font-normal"
              style={{
                fontFamily:
                  'var(--font-p22-typewriter), var(--font-archivo), monospace',
              }}
            >
              {cover.commentary}
            </p>
          </div>
          <div
            ref={backShadeRef}
            aria-hidden="true"
            style={{ opacity: 0.56 }}
            className="pointer-events-none absolute inset-0 z-20 bg-gradient-to-l from-black/75 via-black/40 to-black/15"
          />
        </div>

        {/* Left Spine Edge */}
        <div
          aria-hidden="true"
          style={{
            width: slabDepth,
            height: coverSize,
            left: 0,
            top: 0,
            backfaceVisibility: 'hidden',
            WebkitBackfaceVisibility: 'hidden',
            transform: `translateX(${-halfD}px) rotateY(-90deg)`,
            background:
              'linear-gradient(to right, #dfd9c7 0%, #52504b 48%, #18181b 100%)',
          }}
          className="pointer-events-none absolute rounded-none"
        />

        {/* Right Edge */}
        <div
          aria-hidden="true"
          style={{
            width: slabDepth,
            height: coverSize,
            right: 0,
            top: 0,
            backfaceVisibility: 'hidden',
            WebkitBackfaceVisibility: 'hidden',
            transform: `translateX(${halfD}px) rotateY(90deg)`,
            background:
              'linear-gradient(to right, #18181b 0%, #52504b 52%, #e5e0cf 100%)',
          }}
          className="pointer-events-none absolute rounded-none"
        />

        {/* Top Edge */}
        <div
          aria-hidden="true"
          style={{
            width: coverSize,
            height: slabDepth,
            left: 0,
            top: 0,
            backfaceVisibility: 'hidden',
            WebkitBackfaceVisibility: 'hidden',
            transform: `translateY(${-halfD}px) rotateX(90deg)`,
            background:
              'linear-gradient(to bottom, #e5e0cf 0%, #52504b 48%, #18181b 100%)',
          }}
          className="pointer-events-none absolute rounded-none"
        />

        {/* Bottom Edge */}
        <div
          aria-hidden="true"
          style={{
            width: coverSize,
            height: slabDepth,
            left: 0,
            bottom: 0,
            backfaceVisibility: 'hidden',
            WebkitBackfaceVisibility: 'hidden',
            transform: `translateY(${halfD}px) rotateX(-90deg)`,
            background:
              'linear-gradient(to bottom, #141416 0%, #444340 52%, #d8d2c0 100%)',
          }}
          className="pointer-events-none absolute rounded-none"
        />
      </div>

      {/* Dynamic Floor Contact Shadow responding to 3D slab rotation */}
      <div
        ref={contactShadowRef}
        aria-hidden="true"
        className="pointer-events-none absolute left-[8%] w-[84%] h-4"
        style={{
          top: 'calc(100% + 2px)',
          background:
            'radial-gradient(ellipse at center, rgba(0, 0, 0, 0.88) 0%, rgba(0, 0, 0, 0) 72%)',
          filter: 'blur(4px)',
          transform: 'rotateX(70deg) scaleX(1)',
          opacity: 0.68,
        }}
      />

      {/* Synchronized 3D Floor Reflection Slab */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute overflow-hidden"
        style={{
          top: 'calc(100% + 8px)',
          left: -reflPadX,
          width: coverSize + reflPadX * 2,
          height: coverSize,
          maskImage:
            'linear-gradient(to bottom, rgba(0, 0, 0, 0.34) 0%, rgba(0, 0, 0, 0.1) 34%, transparent 62%)',
          WebkitMaskImage:
            'linear-gradient(to bottom, rgba(0, 0, 0, 0.34) 0%, rgba(0, 0, 0, 0.1) 34%, transparent 62%)',
        }}
      >
        <div
          className="relative mx-auto"
          style={{
            width: coverSize,
            height: coverSize,
          }}
        >
          <div
            ref={reflSlabRef}
            style={{
              transformStyle: 'preserve-3d',
            }}
            className="relative w-full h-full rounded-none"
          >
            {/* Front Reflection Face */}
            <div
              style={{
                backfaceVisibility: 'hidden',
                WebkitBackfaceVisibility: 'hidden',
                transform: `translateZ(${halfD}px)`,
              }}
              className="absolute inset-0 w-full h-full rounded-none overflow-hidden"
            >
              <div className="relative w-full h-full bg-neutral-900 rounded-none overflow-hidden -scale-y-100">
                {!isFailed && (
                  <Image
                    loader={directImageLoader}
                    src={cover.imageUrl}
                    alt=""
                    fill
                    sizes={imageSizes}
                    referrerPolicy="no-referrer"
                    draggable={false}
                    className="object-cover select-none pointer-events-none"
                  />
                )}
                <div
                  ref={(el) => registerReflectionDimRef(cover.id, el)}
                  aria-hidden="true"
                  style={{ opacity: initialDimOpacity }}
                  className="pointer-events-none absolute inset-0 bg-black"
                />
              </div>
            </div>

            {/* Back Reflection Face */}
            <div
              style={{
                backfaceVisibility: 'hidden',
                WebkitBackfaceVisibility: 'hidden',
                transform: `rotateY(180deg) translateZ(${halfD}px)`,
              }}
              className="absolute inset-0 w-full h-full rounded-none overflow-hidden"
            >
              <div className="relative w-full h-full bg-[#faf8ee] rounded-none overflow-hidden flex items-center justify-center p-4 sm:p-6 -scale-y-100">
                <Image
                  src={paperBg}
                  alt=""
                  fill
                  sizes={imageSizes}
                  referrerPolicy="no-referrer"
                  draggable={false}
                  className="object-cover select-none pointer-events-none"
                />
                <p
                  className="relative z-10 text-[11px] sm:text-[13px] leading-[1.6] text-[#1c1b19]/85 text-left font-normal line-clamp-6"
                  style={{
                    fontFamily:
                      'var(--font-p22-typewriter), var(--font-archivo), monospace',
                  }}
                >
                  {cover.commentary}
                </p>
              </div>
            </div>

            {/* Left Reflection Spine Edge */}
            <div
              aria-hidden="true"
              style={{
                width: slabDepth,
                height: coverSize,
                left: 0,
                top: 0,
                backfaceVisibility: 'hidden',
                WebkitBackfaceVisibility: 'hidden',
                transform: `translateX(${-halfD}px) rotateY(-90deg)`,
                background:
                  'linear-gradient(to right, #cfc9b8 0%, #444340 48%, #141416 100%)',
              }}
              className="pointer-events-none absolute rounded-none"
            />

            {/* Right Reflection Edge */}
            <div
              aria-hidden="true"
              style={{
                width: slabDepth,
                height: coverSize,
                right: 0,
                top: 0,
                backfaceVisibility: 'hidden',
                WebkitBackfaceVisibility: 'hidden',
                transform: `translateX(${halfD}px) rotateY(90deg)`,
                background:
                  'linear-gradient(to right, #141416 0%, #444340 52%, #d8d3c2 100%)',
              }}
              className="pointer-events-none absolute rounded-none"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
