export interface TrackEntry {
  trackTitle: string;
  previewUrl: string | null;
}

export interface AlbumTrackInfo {
  tracks: TrackEntry[];
}

const trackCache = new Map<string, AlbumTrackInfo | null>();
const inflightRequests = new Map<string, Promise<AlbumTrackInfo | null>>();

export function extractSpotifyAlbumId(spotifyUrl: string): string | null {
  const match = spotifyUrl.match(/open\.spotify\.com\/album\/([a-zA-Z0-9]+)/);
  return match ? match[1] : null;
}

interface SpotifyEmbedTrack {
  title?: string;
  isPlayable?: boolean;
  audioPreview?: {
    url?: string | null;
  } | null;
}

export async function getAlbumTrackInfo(
  spotifyUrlOrId: string
): Promise<AlbumTrackInfo | null> {
  const albumId = spotifyUrlOrId.includes('spotify.com')
    ? extractSpotifyAlbumId(spotifyUrlOrId)
    : /^[a-zA-Z0-9]+$/.test(spotifyUrlOrId)
      ? spotifyUrlOrId
      : null;

  if (!albumId) return null;

  if (trackCache.has(albumId)) {
    return trackCache.get(albumId) ?? null;
  }

  const existing = inflightRequests.get(albumId);
  if (existing) {
    return existing;
  }

  const promise = (async (): Promise<AlbumTrackInfo | null> => {
    try {
      const res = await fetch(
        `https://open.spotify.com/embed/album/${albumId}`,
        {
          signal: AbortSignal.timeout(3500),
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; synthavard/1.0)',
          },
        }
      );

      if (!res.ok) {
        return null;
      }

      const html = await res.text();
      const match = html.match(
        /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/
      );
      if (!match) {
        return null;
      }

      const data = JSON.parse(match[1]);
      const trackList: SpotifyEmbedTrack[] | undefined =
        data?.props?.pageProps?.state?.data?.entity?.trackList;

      if (!Array.isArray(trackList) || trackList.length === 0) {
        return null;
      }

      const playable = trackList.filter(
        (t): t is SpotifyEmbedTrack & { title: string } =>
          Boolean(t?.title) && t?.isPlayable !== false
      );
      const sourceList =
        playable.length > 0
          ? playable
          : trackList.filter(
              (t): t is SpotifyEmbedTrack & { title: string } =>
                Boolean(t?.title)
            );

      if (sourceList.length === 0) {
        return null;
      }

      const tracks: TrackEntry[] = sourceList.map((t) => ({
        trackTitle: t.title,
        previewUrl: t.audioPreview?.url ?? null,
      }));

      const info: AlbumTrackInfo = { tracks };
      trackCache.set(albumId, info);
      return info;
    } catch {
      return null;
    } finally {
      inflightRequests.delete(albumId);
    }
  })();

  inflightRequests.set(albumId, promise);
  return promise;
}
