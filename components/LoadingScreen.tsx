'use client';

import React, { useEffect, useRef, useState } from 'react';

interface LoadingScreenProps {
  assetUrls: string[];
  onComplete: () => void;
}

const SAFETY_TIMEOUT_MS = 45000;
const COMPLETE_DWELL_MS = 350;

export default function LoadingScreen({
  assetUrls,
  onComplete,
}: LoadingScreenProps) {
  const [progress, setProgress] = useState(0);
  const onCompleteRef = useRef(onComplete);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    let cancelled = false;
    let isFinished = false;
    let loadedCount = 0;
    let currentDisplayProgress = 0;

    const uniqueAssets = Array.from(new Set(assetUrls.filter(Boolean)));
    const totalAssets = uniqueAssets.length;

    let completeTimer: number | null = null;
    let safetyTimer: number | null = null;
    let tweenTimer: number | null = null;
    const preloadedImages: HTMLImageElement[] = [];

    const finishLoading = () => {
      if (cancelled || isFinished) return;
      isFinished = true;
      if (tweenTimer !== null) {
        window.clearInterval(tweenTimer);
        tweenTimer = null;
      }
      if (safetyTimer !== null) {
        window.clearTimeout(safetyTimer);
        safetyTimer = null;
      }
      currentDisplayProgress = 100;
      setProgress(100);
      completeTimer = window.setTimeout(() => {
        if (!cancelled) {
          onCompleteRef.current();
        }
      }, COMPLETE_DWELL_MS);
    };

    if (totalAssets === 0) {
      finishLoading();
      return () => {
        cancelled = true;
        if (completeTimer !== null) window.clearTimeout(completeTimer);
      };
    }

    const onAssetLoaded = () => {
      if (cancelled || isFinished) return;
      loadedCount += 1;
    };

    for (const url of uniqueAssets) {
      const img = new window.Image();
      let settled = false;

      const handleDone = () => {
        if (settled) return;
        settled = true;
        onAssetLoaded();
      };

      img.referrerPolicy = 'no-referrer';
      img.decoding = 'async';
      img.onload = () => {
        if (typeof img.decode === 'function') {
          img.decode().catch(() => {}).finally(handleDone);
        } else {
          handleDone();
        }
      };
      img.onerror = handleDone;
      img.src = url;
      preloadedImages.push(img);
    }

    tweenTimer = window.setInterval(() => {
      if (cancelled || isFinished) return;
      const realTarget = Math.round((loadedCount / totalAssets) * 100);
      if (currentDisplayProgress < realTarget) {
        currentDisplayProgress += 1;
        setProgress(currentDisplayProgress);
      }

      if (loadedCount >= totalAssets && currentDisplayProgress >= 100) {
        finishLoading();
      }
    }, 14);

    safetyTimer = window.setTimeout(() => {
      finishLoading();
    }, SAFETY_TIMEOUT_MS);

    return () => {
      cancelled = true;
      if (tweenTimer !== null) window.clearInterval(tweenTimer);
      if (safetyTimer !== null) window.clearTimeout(safetyTimer);
      if (completeTimer !== null) window.clearTimeout(completeTimer);
      for (const img of preloadedImages) {
        img.onload = null;
        img.onerror = null;
      }
    };
  }, [assetUrls]);

  const clipInsetRight = Math.max(0, 100 - progress);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`Loading ${progress}%`}
      className="fixed inset-0 flex items-center justify-center bg-black z-50 overflow-hidden select-none w-screen h-[calc(var(--vh,1vh)*100)] px-2 md:px-8 rounded-none"
    >
      <svg
        viewBox="0 0 1000 120"
        className="w-full h-full max-h-[85vh]"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <text
          x="50%"
          y="50%"
          dominantBaseline="central"
          textAnchor="middle"
          fontSize="115"
          fill="none"
          stroke="rgba(255, 255, 255, 0.95)"
          strokeWidth="3.2"
          style={{
            fontFamily: 'var(--font-archivo), "Archivo", sans-serif',
            fontWeight: 900,
            clipPath: `inset(0 ${clipInsetRight}% 0 0)`,
            WebkitClipPath: `inset(0 ${clipInsetRight}% 0 0)`,
          }}
        >
          LOADING
        </text>
      </svg>
    </div>
  );
}
