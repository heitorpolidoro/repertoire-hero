# Implementation Plan (RFC) - Repertoire Hero

## 1. Proposed Architecture
The application will follow a **Full-stack Serverless** pattern.
- **Frontend:** Next.js (React) hosted on Vercel.
- **Backend/Database:** Supabase (PostgreSQL + PostgREST + Auth).
- **Client-Side State:** React Context or Zustand for song filtering and UI state.

## 2. Data Schema (PostgreSQL)

## 2. Data Schema (PostgreSQL)

### Table: `profiles`
- `id`: uuid (references auth.users)
- `email`: text
- `full_name`: text

### Table: `global_songs`
- `id`: uuid (primary key)
- `title`: text (required)
- `artist`: text (required)
- `standard_key`: text
- `links`: jsonb (shared links like Youtube, Chords)
- `created_at`: timestamp

### Table: `user_repertoire`
- `id`: uuid (primary key)
- `user_id`: uuid (references profiles.id)
- `song_id`: uuid (references global_songs.id)
- `personal_key`: text
- `status`: song_status (enum: 'unknown', 'learning', 'practicing', 'polishing', 'mastered')
- `tags`: text[]
- `last_practiced`: timestamp

### Table: `bands` (Future)
- `id`: uuid (primary key)
- `name`: text
- `created_by`: uuid (references profiles.id)

### Table: `band_members` (Future)
- `band_id`: uuid (references bands.id)
- `user_id`: uuid (references profiles.id)
- `role`: text (e.g., 'Guitar', 'Vocals')

### Table: `playlists`
- `id`: uuid (primary key)
- `name`: text
- `owner_id`: uuid (references profiles.id)
- `band_id`: uuid (optional, references bands.id)
- `is_public`: boolean

### Table: `playlist_songs`
- `playlist_id`: uuid (references playlists.id)
- `song_id`: uuid (references global_songs.id)
- `order`: integer
- `band_tags`: text[] (Exclusive tags for the song within this playlist/band context)

### Unique Constraint:
- A unique constraint on `(user_id, song_id)` in `user_repertoire` to prevent duplicate entries of the same song for one user.

## 3. Auth Strategy & Local Bypass
- **Production:** Supabase Auth (Email/OTP or Social).
- **Local/Development:** 
    - A custom middleware or initialization script will check for the `NEXT_PUBLIC_AUTO_LOGIN` environment variable.
    - If enabled, the app will automatically sign in using a pre-seeded JWT or session for `heitor.polidoro@gmail.com`.

## 4. Requirements Mapping
- **Mobile + Desktop:** Handled by Next.js Responsive Design (Tailwind CSS).
- **CRUD & Status:** Handled by Supabase auto-generated REST API.
- **Local Seed:** A `seed.sql` file will be provided in the Supabase migrations folder.

## 5. Trade-offs Analysis
- **Alternative:** Custom Node.js Express API + RDS.
- **Why not:** Increased maintenance overhead and higher cost for the initial phase. Supabase provides the same PostgreSQL power with zero initial configuration.

## 6. Security
- **Row Level Security (RLS):** Enabled on all tables. Users can only see and edit their own songs (`user_id = auth.uid()`).
