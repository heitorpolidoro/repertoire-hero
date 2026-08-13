import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const loadEnv = (fileName) => {
  try {
    const envPath = path.resolve(__dirname, '..', fileName);
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      content.split('\n').forEach((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return;
        const idx = trimmed.indexOf('=');
        if (idx > 0) {
          const key = trimmed.substring(0, idx).trim();
          let val = trimmed.substring(idx + 1).trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.substring(1, val.length - 1);
          }
          process.env[key] = val;
        }
      });
    }
  } catch (e) {
    // Ignore env loading errors
  }
};

loadEnv('.env.local');
loadEnv('.env.development.local');

function sanitizeSongTitle(title) {
  if (!title) return '';
  let cleaned = title.trim();

  cleaned = cleaned.replace(/\s*[\(\[]\s*[^()\[\]]*\b(?:remaster|remastered|re-master|re-mastered|deluxe|anniversary|expanded|edition)\b[^()\[\]]*[\)\]]/gi, (match) => {
    if (/\b(live|acoustic|unplugged|demo|cover|instrumental|orchestral)\b/i.test(match)) {
      return match;
    }
    return '';
  });

  cleaned = cleaned.replace(/\s*-\s*.*?\b(?:remaster|remastered|re-master|re-mastered|deluxe|anniversary|expanded)\b.*$/gi, (match) => {
    if (/\b(live|acoustic|unplugged|demo|cover|instrumental|orchestral)\b/i.test(match)) {
      return match;
    }
    return '';
  });

  cleaned = cleaned
    .replace(/\(\s*\)/g, '')
    .replace(/\[\s*\]/g, '')
    .replace(/\s*-\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned || title.trim();
}

async function fetchUrlTitle(url) {
  if (!url) return '';
  const cleanUrl = url.trim();
  const lower = cleanUrl.toLowerCase();
  try {
    if (lower.includes('youtube.com/') || lower.includes('youtu.be/')) {
      const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(cleanUrl)}&format=json`);
      if (res.ok) {
        const data = await res.json();
        if (data.title?.trim()) return data.title.trim();
      }
    }
    if (lower.includes('spotify.com/')) {
      const res = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(cleanUrl)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.title?.trim()) return data.title.trim();
      }
    }
  } catch {
    // ignore
  }
  return '';
}

async function runDeduplication() {
  const connectionString =
    process.env.POSTGRES_URL ||
    process.env.DATABASE_URL ||
    process.env.BETTER_AUTH_DATABASE_URL;

  if (!connectionString) {
    console.log('Skipping song deduplication: No database URL provided.');
    process.exit(0);
  }

  const pool = new Pool({
    connectionString,
    ssl:
      connectionString.includes('localhost') || connectionString.includes('127.0.0.1')
        ? false
        : { rejectUnauthorized: false },
  });

  try {
    const testClient = await pool.connect();
    testClient.release();
  } catch (err) {
    console.warn('⚠️ Could not connect to Postgres DB — skipping deduplication during build.');
    await pool.end();
    return;
  }

  try {
    console.log('Running retroactive song deduplication & album/link title migration scan...');
    const { rows: allSongs } = await pool.query('SELECT id, title, artist, album, links FROM global_songs ORDER BY created_at ASC');

    // 1. Sanitize Albums & Upgrade Links for all existing songs
    for (const song of allSongs) {
      let needsUpdate = false;

      // Sanitize album
      const cleanAlbum = song.album ? sanitizeSongTitle(song.album) : null;
      const finalAlbum = cleanAlbum || null;
      if (song.album !== finalAlbum) {
        needsUpdate = true;
      }

      // Upgrade links if label is generic "spotify" or blank
      const updatedLinks = [];
      let linksChanged = false;
      const currentLinks = song.links || [];

      for (const link of currentLinks) {
        const currentLabel = (link.label || '').trim().toLowerCase();
        if (!currentLabel || currentLabel === 'spotify' || currentLabel === 'link') {
          const fetchedTitle = await fetchUrlTitle(link.url);
          if (fetchedTitle) {
            updatedLinks.push({ label: fetchedTitle, url: link.url });
            linksChanged = true;
            continue;
          }
        }
        updatedLinks.push(link);
      }

      if (needsUpdate || linksChanged) {
        await pool.query(
          'UPDATE global_songs SET album = $1, links = $2 WHERE id = $3',
          [finalAlbum, JSON.stringify(linksChanged ? updatedLinks : currentLinks), song.id]
        );
      }
    }

    // 2. Group and Deduplicate Songs
    const groups = new Map();

    for (const song of allSongs) {
      const cleanTitle = sanitizeSongTitle(song.title);
      const key = `${cleanTitle.toLowerCase()}|||${(song.artist || '').trim().toLowerCase()}`;

      if (!groups.has(key)) {
        groups.set(key, { cleanTitle, artist: song.artist, songs: [] });
      }
      groups.get(key).songs.push(song);
    }

    let mergedCount = 0;

    for (const [key, group] of groups.entries()) {
      if (group.songs.length <= 1) continue;

      const primary = group.songs[0];
      const secondaries = group.songs.slice(1);

      console.log(`Deduplicating group: "${group.cleanTitle}" by ${group.artist} (${group.songs.length} entries)`);

      if (primary.title !== group.cleanTitle) {
        await pool.query('UPDATE global_songs SET title = $1 WHERE id = $2', [group.cleanTitle, primary.id]);
      }

      for (const sec of secondaries) {
        // 1. Merge links
        const primaryLinks = primary.links || [];
        const secLinks = sec.links || [];
        const mergedLinks = [...primaryLinks];
        for (const l of secLinks) {
          if (!mergedLinks.some((x) => x.url === l.url)) {
            mergedLinks.push(l);
          }
        }
        await pool.query('UPDATE global_songs SET links = $1 WHERE id = $2', [JSON.stringify(mergedLinks), primary.id]);

        // 2. Update playlist_songs
        const { rows: secPs } = await pool.query('SELECT playlist_id FROM playlist_songs WHERE song_id = $1', [sec.id]);
        for (const ps of secPs) {
          const { rowCount } = await pool.query('SELECT id FROM playlist_songs WHERE playlist_id = $1 AND song_id = $2', [ps.playlist_id, primary.id]);
          if (rowCount > 0) {
            await pool.query('DELETE FROM playlist_songs WHERE playlist_id = $1 AND song_id = $2', [ps.playlist_id, sec.id]);
          } else {
            await pool.query('UPDATE playlist_songs SET song_id = $1 WHERE playlist_id = $2 AND song_id = $3', [primary.id, ps.playlist_id, sec.id]);
          }
        }

        // 3. Update repertoire
        const { rows: secRep } = await pool.query('SELECT id, user_id, band_id FROM repertoire WHERE song_id = $1', [sec.id]);
        for (const rep of secRep) {
          const ownerWhere = rep.band_id ? 'band_id = $1' : 'user_id = $1';
          const ownerVal = rep.band_id ? rep.band_id : rep.user_id;
          const { rows: existingRep } = await pool.query(`SELECT id FROM repertoire WHERE ${ownerWhere} AND song_id = $2`, [ownerVal, primary.id]);

          if (existingRep.length > 0) {
            await pool.query('UPDATE repertoire_tabs SET repertoire_id = $1 WHERE repertoire_id = $2', [existingRep[0].id, rep.id]);
            await pool.query('DELETE FROM repertoire WHERE id = $1', [rep.id]);
          } else {
            await pool.query('UPDATE repertoire SET song_id = $1 WHERE id = $2', [primary.id, rep.id]);
          }
        }

        // 4. Delete duplicate global song
        await pool.query('DELETE FROM global_songs WHERE id = $1', [sec.id]);
        mergedCount++;
      }
    }

    console.log(`Deduplication scan complete. Merged ${mergedCount} duplicate song entries.`);
  } catch (err) {
    console.error('Deduplication script error:', err);
  } finally {
    await pool.end();
  }
}

runDeduplication().catch((err) => {
  console.error(err);
  process.exit(1);
});
