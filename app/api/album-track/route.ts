import { NextRequest, NextResponse } from 'next/server';
import { getAlbumTrackInfo } from '@/lib/spotify-track';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const urlOrId = searchParams.get('url') || searchParams.get('albumId') || '';

  if (!urlOrId) {
    return NextResponse.json({ tracks: [] }, { status: 400 });
  }

  const info = await getAlbumTrackInfo(urlOrId);
  return NextResponse.json(info ?? { tracks: [] }, {
    headers: {
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
