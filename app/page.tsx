import fs from 'node:fs';
import path from 'node:path';
import type { AlbumItem } from '@/components/CoverFlow';
import SynthavardApp from '@/components/SynthavardApp';
import { getAlbumTrackInfo } from '@/lib/spotify-track';

function parseCsvRow(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      fields.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

function loadAlbumsFromCsv(): AlbumItem[] {
  const csvPath = path.join(
    process.cwd(),
    'public',
    'assets',
    'aistudio',
    'albums__1__e5a35dab.csv'
  );
  const raw = fs.readFileSync(csvPath, 'utf-8');
  const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);

  const albums: AlbumItem[] = [];
  for (let i = 1; i < lines.length; i++) {
    const [title, artist, imageUrl, spotifyUrl, commentary] = parseCsvRow(
      lines[i]
    );
    if (!title || !imageUrl) continue;
    const id = albums.length;
    albums.push({
      id,
      label: String(id + 1).padStart(2, '0'),
      title,
      artist: artist || '',
      imageUrl,
      spotifyUrl: spotifyUrl || '',
      commentary: commentary || '',
    });
  }

  return albums;
}

export default async function Page() {
  const albums = loadAlbumsFromCsv();
  const initialTrack =
    albums.length > 0 && albums[0].spotifyUrl
      ? await getAlbumTrackInfo(albums[0].spotifyUrl)
      : null;

  return <SynthavardApp albums={albums} initialTrack={initialTrack} />;
}
