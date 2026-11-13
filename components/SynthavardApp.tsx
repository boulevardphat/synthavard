'use client';

import React, { useEffect, useMemo, useState } from 'react';
import CoverFlow, { type AlbumItem } from '@/components/CoverFlow';
import LoadingScreen from '@/components/LoadingScreen';
import type { AlbumTrackInfo } from '@/lib/spotify-track';

interface SynthavardAppProps {
  albums: AlbumItem[];
  initialTrack?: AlbumTrackInfo | null;
}

export default function SynthavardApp({
  albums,
  initialTrack = null,
}: SynthavardAppProps) {
  const [isLoaded, setIsLoaded] = useState(false);

  const assetUrls = useMemo(
    () => albums.map((album) => album.imageUrl).filter(Boolean),
    [albums]
  );

  useEffect(() => {
    let lastWidth = window.innerWidth;
    let lastHeight = window.innerHeight;

    const applyVh = () => {
      const vh = window.innerHeight * 0.01;
      document.documentElement.style.setProperty('--vh', `${vh}px`);
    };

    const handleResize = () => {
      const nextWidth = window.innerWidth;
      const nextHeight = window.innerHeight;
      const widthChanged = nextWidth !== lastWidth;
      const heightJump = Math.abs(nextHeight - lastHeight) > 150;

      if (widthChanged || heightJump) {
        lastWidth = nextWidth;
        lastHeight = nextHeight;
        applyVh();
      }
    };

    applyVh();
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  return (
    <div className="relative w-screen h-[calc(var(--vh,1vh)*100)] overflow-hidden bg-black rounded-none">
      {!isLoaded && (
        <LoadingScreen
          assetUrls={assetUrls}
          onComplete={() => setIsLoaded(true)}
        />
      )}
      <CoverFlow
        albums={albums}
        initialTrack={initialTrack}
        isReady={isLoaded}
      />
    </div>
  );
}
