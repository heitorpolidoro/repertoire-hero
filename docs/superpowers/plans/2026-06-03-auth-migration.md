# Auth Migration: Supabase Auth → Better Auth — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Supabase Auth with Better Auth, keeping the Supabase PostgreSQL database and all existing tables intact.

**Architecture:** Better Auth runs inside Next.js and connects to Supabase PostgreSQL via a direct `DATABASE_URL`. Since Supabase RLS relies on the Supabase Auth JWT (not Better Auth's), all user-specific DB queries are migrated to use the Supabase admin client (service role) with explicit `user_id` filters. Server Actions wrap lib functions for calls coming from client components (Zustand store).

**Tech Stack:** `better-auth`, `pg`, `@types/pg`. No new services — Better Auth stores sessions in the existing Supabase PostgreSQL.

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `src/lib/auth.ts` | Create | Better Auth server config (email/password, no email verification) |
| `src/lib/auth-client.ts` | Create | Better Auth browser client (`createAuthClient`) |
| `src/lib/auth-session.ts` | Create | Server-side helper: `getRequiredUserId(headers?)` |
| `src/app/api/auth/[...all]/route.ts` | Create | Better Auth HTTP handler |
| `src/app/actions/repertoire.ts` | Create | Server Actions wrapping songs lib for Zustand store |
| `src/middleware.ts` | Modify | Replace `supabase.auth.getUser()` with `auth.api.getSession()` |
| `src/app/login/page.tsx` | Modify | Replace Supabase SDK calls with `authClient.signIn.email()` |
| `src/app/signup/page.tsx` | Modify | Replace Supabase SDK calls with `authClient.signUp.email()` |
| `src/lib/songs.ts` | Modify | Accept `userId` param, use admin client, explicit `.eq('user_id', userId)` |
| `src/lib/profile.ts` | Modify | Accept `userId` param, use admin client |
| `src/lib/playlists.ts` | Modify | Accept `userId` param, use admin client |
| `src/lib/spotifyAuth.ts` | Modify | Accept `userId` param instead of calling `supabase.auth.getUser()` |
| `src/store/repertoireStore.ts` | Modify | Import from `src/app/actions/repertoire.ts` instead of `src/lib/songs.ts` |
| `src/components/Sidebar.tsx` | Modify | Replace Supabase auth with `authClient.useSession()` + `authClient.signOut()` |
| `src/components/layout/AppLayout.tsx` | Modify | Replace `supabase.auth.signOut()` with `authClient.signOut()` |
| `src/app/api/auth/spotify/callback/route.ts` | Modify | Replace `supabase.auth.getUser()` with `getRequiredUserId()` |
| `src/app/api/auth/spotify/disconnect/route.ts` | Modify | Replace `supabase.auth.getUser()` with `getRequiredUserId()` |
| `src/app/api/spotify/playlists/[id]/sync/route.ts` | Modify | Replace `supabase.auth.getUser()` with `getRequiredUserId()` |
| `src/app/api/spotify/playlists/[id]/import/route.ts` | Modify | Replace `supabase.auth.getUser()` with `getRequiredUserId()` |
| `src/app/join/[code]/page.tsx` | Modify | Replace `supabase.auth.getUser()` with `getRequiredUserId()` |
| `src/app/bands/[id]/page.tsx` | Modify | Replace `supabase.auth.getUser()` with `getRequiredUserId()` |
| `src/app/api/auth/dev-login/route.ts` | Modify | Replace Supabase sign-in with Better Auth admin session creation |
| `supabase/migrations/TIMESTAMP_add_better_auth_tables.sql` | Create | Schema for `user`, `session`, `account`, `verification` tables |
| `scripts/migrate-auth.ts` | Create | One-time idempotent script: ports users from `auth.users` to Better Auth |
| `.github/workflows/ci.yml` | Modify | Temporary: add `migrate-users` job after build |
| `.env.local` | Modify | Add `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `NEXT_PUBLIC_APP_URL` |

---

## Task 1: Install dependencies and configure environment variables

**Files:**
- Modify: `.env.local`

- [ ] **Step 1: Install packages**

```bash
npm install better-auth pg
npm install --save-dev @types/pg
```

Expected output: packages added to `package.json`.

- [ ] **Step 2: Get DATABASE_URL from Supabase**

Go to [Supabase Dashboard](https://app.supabase.com) → your project → **Settings → Database → Connection string → URI** (use the **pooling** URI, port 6543).

It looks like: `postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres`

- [ ] **Step 3: Generate BETTER_AUTH_SECRET**

```bash
openssl rand -base64 32
```

Copy the output.

- [ ] **Step 4: Add variables to `.env.local`**

Add these lines (do not commit `.env.local`):

```bash
DATABASE_URL=postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres
BETTER_AUTH_SECRET=<output from openssl above>
BETTER_AUTH_URL=http://localhost:3000
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

- [ ] **Step 5: Commit dependency changes only**

```bash
.meridian/meridian-agent git add package.json package-lock.json
.meridian/meridian-agent git commit -m "chore: install better-auth and pg"
```

---

## Task 2: Create Better Auth DB migration

**Files:**
- Create: `supabase/migrations/<timestamp>_add_better_auth_tables.sql`

- [ ] **Step 1: Generate the migration file**

```bash
supabase migration new add_better_auth_tables
```

This creates `supabase/migrations/<timestamp>_add_better_auth_tables.sql`.

- [ ] **Step 2: Write the migration SQL**

Open the file and paste:

```sql
-- Better Auth tables
-- These live alongside existing Supabase tables (profiles, repertoire, etc.)

CREATE TABLE IF NOT EXISTS "user" (
  "id"            TEXT        PRIMARY KEY,
  "name"          TEXT        NOT NULL,
  "email"         TEXT        NOT NULL UNIQUE,
  "emailVerified" BOOLEAN     NOT NULL DEFAULT FALSE,
  "image"         TEXT,
  "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "session" (
  "id"          TEXT        PRIMARY KEY,
  "expiresAt"   TIMESTAMPTZ NOT NULL,
  "token"       TEXT        NOT NULL UNIQUE,
  "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "ipAddress"   TEXT,
  "userAgent"   TEXT,
  "userId"      TEXT        NOT NULL REFERENCES "user"("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "account" (
  "id"                    TEXT        PRIMARY KEY,
  "accountId"             TEXT        NOT NULL,
  "providerId"            TEXT        NOT NULL,
  "userId"                TEXT        NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "accessToken"           TEXT,
  "refreshToken"          TEXT,
  "idToken"               TEXT,
  "accessTokenExpiresAt"  TIMESTAMPTZ,
  "refreshTokenExpiresAt" TIMESTAMPTZ,
  "scope"                 TEXT,
  "password"              TEXT,
  "createdAt"             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "verification" (
  "id"         TEXT        PRIMARY KEY,
  "identifier" TEXT        NOT NULL,
  "value"      TEXT        NOT NULL,
  "expiresAt"  TIMESTAMPTZ NOT NULL,
  "createdAt"  TIMESTAMPTZ,
  "updatedAt"  TIMESTAMPTZ
);
```

- [ ] **Step 3: Apply the migration locally**

```bash
supabase db push
```

Expected: migration applied without errors.

- [ ] **Step 4: Commit**

```bash
.meridian/meridian-agent git add supabase/migrations/
.meridian/meridian-agent git commit -m "chore: add Better Auth tables migration"
```

---

## Task 3: Create Better Auth config files

**Files:**
- Create: `src/lib/auth.ts`
- Create: `src/lib/auth-client.ts`
- Create: `src/lib/auth-session.ts`
- Create: `src/app/api/auth/[...all]/route.ts`

- [ ] **Step 1: Create `src/lib/auth.ts`**

```ts
import { betterAuth } from 'better-auth'
import { Pool } from 'pg'

export const auth = betterAuth({
  database: new Pool({
    connectionString: process.env.DATABASE_URL!,
  }),
  secret: process.env.BETTER_AUTH_SECRET!,
  baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:3000',
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
  },
})
```

- [ ] **Step 2: Create `src/lib/auth-client.ts`**

```ts
import { createAuthClient } from 'better-auth/client'

export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
})
```

- [ ] **Step 3: Create `src/lib/auth-session.ts`**

```ts
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'

export async function getSession() {
  return auth.api.getSession({ headers: await headers() })
}

export async function getRequiredUserId(): Promise<string> {
  const session = await getSession()
  if (!session?.user?.id) throw new Error('Not authenticated')
  return session.user.id
}
```

- [ ] **Step 4: Create `src/app/api/auth/[...all]/route.ts`**

```ts
import { auth } from '@/lib/auth'
import { toNextJsHandler } from 'better-auth/next-js'

export const { GET, POST } = toNextJsHandler(auth)
```

- [ ] **Step 5: Verify the auth handler responds**

Start the dev server (`npm run dev`) and visit `http://localhost:3000/api/auth/get-session`. Expected: `{"session":null}` (no active session yet).

- [ ] **Step 6: Commit**

```bash
.meridian/meridian-agent git add src/lib/auth.ts src/lib/auth-client.ts src/lib/auth-session.ts src/app/api/auth/
.meridian/meridian-agent git commit -m "feat: add Better Auth config, client, session helper, and API handler"
```

---

## Task 4: Update middleware.ts

**Files:**
- Modify: `src/middleware.ts`

- [ ] **Step 1: Replace the file content**

```ts
import { auth } from '@/lib/auth'
import { NextResponse, type NextRequest } from 'next/server'

const PUBLIC_PATHS = ['/login', '/signup', '/api/auth/', '/api/dev/', '/join/']

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const isPublicPath = PUBLIC_PATHS.some((p) => pathname.startsWith(p))

  const session = await auth.api.getSession({ headers: request.headers })
  const user = session?.user ?? null

  // Auto-login: dev convenience — bounce through dev-login if unauthenticated.
  if (
    process.env.NEXT_PUBLIC_AUTO_LOGIN === 'true' &&
    !user &&
    !pathname.startsWith('/api/auth/dev-login')
  ) {
    const devLoginUrl = request.nextUrl.clone()
    devLoginUrl.pathname = '/api/auth/dev-login'
    devLoginUrl.searchParams.set('next', pathname)
    return NextResponse.redirect(devLoginUrl)
  }

  // Unauthenticated users must go to /login (skip public paths to avoid loops).
  if (!user && !isPublicPath) {
    const loginUrl = request.nextUrl.clone()
    loginUrl.pathname = '/login'
    loginUrl.searchParams.set('redirect', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // Authenticated users who land on /login or /signup are sent to the root.
  if (user && (pathname === '/login' || pathname === '/signup')) {
    const homeUrl = request.nextUrl.clone()
    homeUrl.pathname = '/'
    return NextResponse.redirect(homeUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
```

- [ ] **Step 2: Test that unauthenticated requests redirect to `/login`**

Visit `http://localhost:3000/` without a session. Expected: redirect to `/login`.

- [ ] **Step 3: Commit**

```bash
.meridian/meridian-agent git add src/middleware.ts
.meridian/meridian-agent git commit -m "feat: replace Supabase Auth middleware with Better Auth session check"
```

---

## Task 5: Update login page

**Files:**
- Modify: `src/app/login/page.tsx`

- [ ] **Step 1: Replace auth calls in `handleSubmit` and `handleFastLogin`**

Replace only the two Supabase auth call blocks. The rest of the page (UI, dev profiles fetch) stays unchanged.

Replace `handleSubmit`:
```ts
async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
  e.preventDefault()
  setError(null)
  setLoading(true)

  const { error: signInError } = await authClient.signIn.email({
    email,
    password,
  })

  if (signInError) {
    setError(signInError.message)
    setLoading(false)
    return
  }

  router.push(redirect)
  router.refresh()
}
```

Replace `handleFastLogin`:
```ts
async function handleFastLogin(email: string) {
  setError(null)
  setLoading(true)

  const { error: signInError } = await authClient.signIn.email({
    email,
    password: 'password',
  })

  if (signInError) {
    setError(signInError.message)
    setLoading(false)
    return
  }

  router.push(redirect)
  router.refresh()
}
```

- [ ] **Step 2: Update imports at the top of the file**

Remove: `import { createClient } from '@/lib/supabase/client'`

Add: `import { authClient } from '@/lib/auth-client'`

- [ ] **Step 3: Test login manually**

Visit `http://localhost:3000/login`, enter credentials, verify redirect to `/`.

- [ ] **Step 4: Commit**

```bash
.meridian/meridian-agent git add src/app/login/page.tsx
.meridian/meridian-agent git commit -m "feat: replace Supabase Auth login with Better Auth"
```

---

## Task 6: Update signup page

**Files:**
- Modify: `src/app/signup/page.tsx`

- [ ] **Step 1: Replace the `handleSubmit` function**

```ts
async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
  e.preventDefault()
  setError(null)

  if (password !== confirmPassword) {
    setError('Passwords do not match.')
    return
  }

  setLoading(true)

  const { error: signUpError } = await authClient.signUp.email({
    email,
    password,
    name: fullName.trim() || email.split('@')[0],
  })

  if (signUpError) {
    setError(signUpError.message)
    setLoading(false)
    return
  }

  setSuccess(true)
  setLoading(false)
}
```

- [ ] **Step 2: Update the success message**

The current success message says "Check your email to confirm". Since email verification is disabled, change it to:

```tsx
<p className="text-sm text-green-700 bg-green-50 rounded-lg px-3 py-3">
  Account created! You can now{' '}
  <Link href={loginHref} className="font-medium text-emerald-600 hover:text-emerald-500">
    sign in
  </Link>
  .
</p>
```

- [ ] **Step 3: Update imports**

Remove: `import { createClient } from '@/lib/supabase/client'`

Add: `import { authClient } from '@/lib/auth-client'`

Note: `instruments` and `primary_instrument` from the Supabase signup options are not supported directly in Better Auth. These will be saved via `updateProfile()` after the first login (the `profile` row is created by a Supabase DB trigger on `auth.users` insert — this trigger will need to be checked/updated separately if it relies on `auth.users`).

- [ ] **Step 4: Test signup**

Sign up with a new email. Expected: success state shown, then able to log in.

- [ ] **Step 5: Commit**

```bash
.meridian/meridian-agent git add src/app/signup/page.tsx
.meridian/meridian-agent git commit -m "feat: replace Supabase Auth signup with Better Auth"
```

---

## Task 7: Update lib files — songs, profile, playlists

**Files:**
- Modify: `src/lib/songs.ts`
- Modify: `src/lib/profile.ts`
- Modify: `src/lib/playlists.ts`

> All three files are updated the same way: replace `createClient()` with `createAdminClient()`, remove `supabase.auth.getUser()` calls, add `userId: string` parameter where needed, and add explicit `.eq('user_id', userId)` filters that were previously handled by RLS.

- [ ] **Step 1: Update `src/lib/songs.ts`**

Replace the entire file content:

```ts
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import type { GlobalSong, Repertoire, SongLink, SongStatus } from '@/types/database'

export async function getRepertoire(userId: string): Promise<Repertoire[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('repertoire')
    .select('*, song:global_songs(*)')
    .eq('user_id', userId)
    .order('id', { ascending: false })
  if (error) {
    logger.error('Failed to fetch user repertoire', new Error(error.message), { code: error.code })
    throw new Error(`Failed to fetch user repertoire: ${error.message}`)
  }
  return data as Repertoire[]
}

export async function addSongToRepertoire(userId: string, songId: string): Promise<Repertoire> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('repertoire')
    .insert({ song_id: songId, user_id: userId, status: 'unknown' as SongStatus })
    .select('*, song:global_songs(*)')
    .single()
  if (error) {
    logger.error('Failed to add song to repertoire', new Error(error.message), { code: error.code })
    throw new Error(`Failed to add song to repertoire: ${error.message}`)
  }
  return data as Repertoire
}

export async function updateSongStatus(userId: string, repertoireId: string, status: SongStatus): Promise<void> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('repertoire')
    .update({ status })
    .eq('id', repertoireId)
    .eq('user_id', userId)
    .select('id')
  if (error) {
    logger.error('Failed to update song status', new Error(error.message), { code: error.code })
    throw new Error(`Failed to update song status: ${error.message}`)
  }
  if (!data || data.length === 0) throw new Error('Repertoire entry not found or access denied')
}

export async function updateSongTags(userId: string, repertoireId: string, tags: string[]): Promise<void> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('repertoire')
    .update({ tags })
    .eq('id', repertoireId)
    .eq('user_id', userId)
    .select('id')
  if (error) {
    logger.error('Failed to update song tags', new Error(error.message), { code: error.code })
    throw new Error(`Failed to update song tags: ${error.message}`)
  }
  if (!data || data.length === 0) throw new Error('Repertoire entry not found or access denied')
}

export async function updatePersonalKey(userId: string, repertoireId: string, personalKey: string): Promise<void> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('repertoire')
    .update({ personal_key: personalKey })
    .eq('id', repertoireId)
    .eq('user_id', userId)
    .select('id')
  if (error) {
    logger.error('Failed to update personal key', new Error(error.message), { code: error.code })
    throw new Error(`Failed to update personal key: ${error.message}`)
  }
  if (!data || data.length === 0) throw new Error('Repertoire entry not found or access denied')
}

export async function removeSongFromRepertoire(userId: string, repertoireId: string): Promise<void> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('repertoire')
    .delete()
    .eq('id', repertoireId)
    .eq('user_id', userId)
    .select('id')
  if (error) {
    logger.error('Failed to remove song from repertoire', new Error(error.message), { code: error.code })
    throw new Error(`Failed to remove song from repertoire: ${error.message}`)
  }
  if (!data || data.length === 0) throw new Error('Repertoire entry not found or access denied')
}

export async function searchGlobalSongs(query: string): Promise<GlobalSong[]> {
  const supabase = createAdminClient()
  const trimmed = query.trim()
  if (!trimmed) return []
  const { data, error } = await supabase
    .from('global_songs')
    .select('*')
    .or(`title.ilike.%${trimmed}%,artist.ilike.%${trimmed}%`)
    .order('title', { ascending: true })
    .limit(20)
  if (error) {
    logger.error('Failed to search global songs', new Error(error.message), { code: error.code })
    throw new Error(`Failed to search global songs: ${error.message}`)
  }
  return data as GlobalSong[]
}

export async function getSongEntry(userId: string, repertoireId: string): Promise<Repertoire | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('repertoire')
    .select('*, song:global_songs(*)')
    .eq('id', repertoireId)
    .eq('user_id', userId)
    .single()
  if (error) {
    if (error.code === 'PGRST116') return null
    logger.error('Failed to fetch song entry', new Error(error.message), { code: error.code })
    throw new Error(`Failed to fetch song entry: ${error.message}`)
  }
  return data as Repertoire
}

export async function updateSong(
  userId: string,
  entry: Repertoire,
  data: {
    title: string
    artist: string
    album?: string | null
    key: string | null
    status: SongStatus
    tags: string[]
    links: SongLink[]
    cover_url?: string | null
    duration_seconds?: number | null
  }
): Promise<void> {
  const supabase = createAdminClient()
  const { error: songError } = await supabase
    .from('global_songs')
    .update({
      title: data.title,
      artist: data.artist,
      album: data.album ?? null,
      standard_key: data.key,
      cover_url: data.cover_url ?? null,
      duration_seconds: data.duration_seconds ?? null,
      links: data.links,
    })
    .eq('id', entry.song_id)
  if (songError) {
    logger.error('Failed to update global song', new Error(songError.message), { code: songError.code })
    throw new Error(`Failed to update global song: ${songError.message}`)
  }
  const { error: repertoireError } = await supabase
    .from('repertoire')
    .update({ status: data.status, tags: data.tags, personal_key: data.key })
    .eq('id', entry.id)
    .eq('user_id', userId)
  if (repertoireError) {
    logger.error('Failed to update repertoire entry', new Error(repertoireError.message), { code: repertoireError.code })
    throw new Error(`Failed to update repertoire entry: ${repertoireError.message}`)
  }
}

export async function createAndAddSong(
  userId: string,
  data: {
    title: string
    artist: string
    album?: string
    standard_key?: string
    cover_url?: string
    duration_seconds?: number
    links?: SongLink[]
  }
): Promise<Repertoire> {
  const supabase = createAdminClient()
  const albumValue = data.album?.trim() ?? ''

  let lookupQuery = supabase.from('global_songs').select('id').ilike('title', data.title)
  if (albumValue) lookupQuery = lookupQuery.ilike('album', albumValue)
  const { data: existing, error: lookupError } = await lookupQuery.maybeSingle()
  if (lookupError) throw new Error(`Failed to look up global song: ${lookupError.message}`)

  let songId: string
  if (existing) {
    songId = existing.id
  } else {
    const { data: globalSong, error: songError } = await supabase
      .from('global_songs')
      .insert({
        contributor_id: userId,
        title: data.title,
        artist: data.artist,
        album: albumValue || null,
        standard_key: data.standard_key ?? null,
        cover_url: data.cover_url ?? null,
        duration_seconds: data.duration_seconds ?? null,
        links: data.links ?? [],
      })
      .select('id')
      .single()
    if (songError) throw new Error(`Failed to create global song: ${songError.message}`)
    songId = globalSong.id
  }

  const { data: existingEntry } = await supabase
    .from('repertoire')
    .select('id')
    .eq('user_id', userId)
    .eq('song_id', songId)
    .maybeSingle()
  if (existingEntry) throw new Error('Song already in your repertoire')

  const { data: repertoireEntry, error: repertoireError } = await supabase
    .from('repertoire')
    .insert({ song_id: songId, user_id: userId, status: 'unknown' as SongStatus })
    .select('*, song:global_songs(*)')
    .single()
  if (repertoireError) throw new Error(`Song created but failed to add to repertoire: ${repertoireError.message}`)
  return repertoireEntry as Repertoire
}
```

- [ ] **Step 2: Update `src/lib/profile.ts`**

Replace all `supabase.auth.getUser()` calls with the `userId: string` parameter, and replace `createClient()` with `createAdminClient()`.

Read the full current file, then apply this pattern to each function. Example transformation for `getProfile`:

```ts
// Before
export async function getProfile(): Promise<Profile | null> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).single()
  ...
}

// After
export async function getProfile(userId: string): Promise<Profile | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single()
  ...
}
```

Apply the same pattern to all functions in `profile.ts`:
- Change import: `createClient` → `createAdminClient` from `@/lib/supabase/admin`
- Remove all `supabase.auth.getUser()` calls
- Add `userId: string` as first parameter to every function that previously called `getUser()`

- [ ] **Step 3: Update `src/lib/playlists.ts`**

Same transformation as profile.ts. Read the full file first, then apply:
- `createClient` → `createAdminClient`
- Remove `supabase.auth.getUser()` calls
- Add `userId: string` as first parameter
- Add `.eq('user_id', userId)` to queries that relied on RLS for filtering (e.g., `getUserPlaylists`)

- [ ] **Step 4: Run the TypeScript compiler to find broken call sites**

```bash
npm run build 2>&1 | grep "error TS" | head -30
```

This will list every file that calls these functions with the old signature. The next tasks fix those call sites.

- [ ] **Step 5: Commit**

```bash
.meridian/meridian-agent git add src/lib/songs.ts src/lib/profile.ts src/lib/playlists.ts
.meridian/meridian-agent git commit -m "refactor: update lib functions to accept userId, use admin client"
```

---

## Task 8: Create Server Actions for Zustand store

**Files:**
- Create: `src/app/actions/repertoire.ts`
- Modify: `src/store/repertoireStore.ts`

- [ ] **Step 1: Create `src/app/actions/repertoire.ts`**

```ts
'use server'

import { getRequiredUserId } from '@/lib/auth-session'
import {
  getRepertoire,
  addSongToRepertoire,
  updateSongStatus,
  updateSongTags,
  updatePersonalKey,
  removeSongFromRepertoire,
  searchGlobalSongs,
  getSongEntry,
  updateSong,
  createAndAddSong,
} from '@/lib/songs'
import type { Repertoire, SongLink, SongStatus } from '@/types/database'

export async function getRepertoireAction() {
  const userId = await getRequiredUserId()
  return getRepertoire(userId)
}

export async function addSongAction(songId: string) {
  const userId = await getRequiredUserId()
  return addSongToRepertoire(userId, songId)
}

export async function updateSongStatusAction(repertoireId: string, status: SongStatus) {
  const userId = await getRequiredUserId()
  return updateSongStatus(userId, repertoireId, status)
}

export async function updateSongTagsAction(repertoireId: string, tags: string[]) {
  const userId = await getRequiredUserId()
  return updateSongTags(userId, repertoireId, tags)
}

export async function updatePersonalKeyAction(repertoireId: string, personalKey: string) {
  const userId = await getRequiredUserId()
  return updatePersonalKey(userId, repertoireId, personalKey)
}

export async function removeSongAction(repertoireId: string) {
  const userId = await getRequiredUserId()
  return removeSongFromRepertoire(userId, repertoireId)
}

export async function searchGlobalSongsAction(query: string) {
  return searchGlobalSongs(query)
}

export async function getSongEntryAction(repertoireId: string) {
  const userId = await getRequiredUserId()
  return getSongEntry(userId, repertoireId)
}

export async function updateSongAction(
  entry: Repertoire,
  data: {
    title: string
    artist: string
    album?: string | null
    key: string | null
    status: SongStatus
    tags: string[]
    links: SongLink[]
    cover_url?: string | null
    duration_seconds?: number | null
  }
) {
  const userId = await getRequiredUserId()
  return updateSong(userId, entry, data)
}

export async function createAndAddSongAction(data: {
  title: string
  artist: string
  album?: string
  standard_key?: string
  cover_url?: string
  duration_seconds?: number
  links?: SongLink[]
}) {
  const userId = await getRequiredUserId()
  return createAndAddSong(userId, data)
}
```

- [ ] **Step 2: Update `src/store/repertoireStore.ts` imports**

Replace the three imports at the top:

```ts
// Before
import {
  getRepertoire,
  removeSongFromRepertoire,
  updateSongStatus,
} from '@/lib/songs'

// After
import {
  getRepertoireAction as getRepertoire,
  removeSongAction as removeSongFromRepertoire,
  updateSongStatusAction as updateSongStatus,
} from '@/app/actions/repertoire'
```

No other changes to the store — the function signatures match (userId is handled inside the Server Actions).

- [ ] **Step 3: Find all other files importing from `@/lib/songs` and update them**

```bash
grep -rn "from '@/lib/songs'" src/ --include="*.ts" --include="*.tsx"
```

For each non-`repertoireStore` file that imports from `@/lib/songs`:
- If it's a Server Component or API route: call the lib function directly, passing userId from `getRequiredUserId()`
- If it's a Client Component: import the corresponding Server Action from `@/app/actions/repertoire`

- [ ] **Step 4: Run TypeScript check**

```bash
npm run build 2>&1 | grep "error TS" | head -30
```

Fix any remaining type errors from changed signatures.

- [ ] **Step 5: Commit**

```bash
.meridian/meridian-agent git add src/app/actions/repertoire.ts src/store/repertoireStore.ts
.meridian/meridian-agent git commit -m "feat: add Server Actions for repertoire, update Zustand store"
```

---

## Task 9: Update Sidebar and AppLayout

**Files:**
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/components/layout/AppLayout.tsx`

- [ ] **Step 1: Update `src/components/Sidebar.tsx`**

Replace the auth-related section:

```ts
// Before — Supabase
import { createClient } from '@/lib/supabase/client';
// ...
const supabase = createClient();
useEffect(() => {
  supabase.auth.getUser().then(({ data: { user } }) => { setUser(user); });
}, [supabase.auth]);
const handleSignOut = async () => {
  await supabase.auth.signOut();
  router.push('/login');
  router.refresh();
};

// After — Better Auth
import { authClient } from '@/lib/auth-client';
// ...
const { data: session } = authClient.useSession();
const user = session?.user ?? null;
const handleSignOut = async () => {
  await authClient.signOut();
  router.push('/login');
  router.refresh();
};
```

Remove the `useState<User | null>` and `useEffect` for auth — Better Auth's `useSession()` is reactive.

- [ ] **Step 2: Update `src/components/layout/AppLayout.tsx`**

```ts
// Before
import { createClient } from '@/lib/supabase/client';
// ...
const handleSignOut = async (): Promise<void> => {
  const supabase = createClient();
  await supabase.auth.signOut();
  router.push('/login');
};

// After
import { authClient } from '@/lib/auth-client';
// ...
const handleSignOut = async (): Promise<void> => {
  await authClient.signOut();
  router.push('/login');
};
```

- [ ] **Step 3: Commit**

```bash
.meridian/meridian-agent git add src/components/Sidebar.tsx src/components/layout/AppLayout.tsx
.meridian/meridian-agent git commit -m "feat: replace Supabase auth in Sidebar and AppLayout with Better Auth"
```

---

## Task 10: Update Spotify routes and spotifyAuth.ts

**Files:**
- Modify: `src/lib/spotifyAuth.ts`
- Modify: `src/app/api/auth/spotify/callback/route.ts`
- Modify: `src/app/api/auth/spotify/disconnect/route.ts`
- Modify: `src/app/api/spotify/playlists/[id]/sync/route.ts`
- Modify: `src/app/api/spotify/playlists/[id]/import/route.ts`

> Spotify is a "connect your account" feature, not a login method. These routes only need to get the current authenticated user's ID — they don't manage auth sessions.

- [ ] **Step 1: Update `src/lib/spotifyAuth.ts`**

The function signature changes from accepting a `SupabaseClient` to accepting a `userId: string`:

```ts
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'

export async function getSpotifyAccessToken(userId: string): Promise<string | null> {
  const supabase = createAdminClient()

  const { data: tokenRow, error } = await supabase
    .from('spotify_tokens')
    .select('*')
    .eq('user_id', userId)
    .single()

  if (error || !tokenRow) return null

  const expiresAt = new Date(tokenRow.expires_at).getTime()
  const nowWithBuffer = Date.now() + 60_000

  if (expiresAt > nowWithBuffer) return tokenRow.access_token as string

  // Token expired — refresh
  const clientId = process.env.SPOTIFY_CLIENT_ID
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    logger.error('Spotify credentials missing during token refresh')
    return null
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
  const refreshResponse = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokenRow.refresh_token as string,
    }).toString(),
  })

  if (!refreshResponse.ok) {
    logger.error('Spotify token refresh failed', undefined, { status: refreshResponse.status })
    return null
  }

  const refreshJson = (await refreshResponse.json()) as {
    access_token: string
    expires_in: number
    refresh_token?: string
  }

  const newExpiresAt = new Date(Date.now() + refreshJson.expires_in * 1000).toISOString()

  await supabase.from('spotify_tokens').update({
    access_token: refreshJson.access_token,
    refresh_token: refreshJson.refresh_token ?? tokenRow.refresh_token,
    expires_at: newExpiresAt,
    updated_at: new Date().toISOString(),
  }).eq('user_id', userId)

  return refreshJson.access_token
}
```

- [ ] **Step 2: Update `src/app/api/auth/spotify/callback/route.ts`**

Replace the auth block:
```ts
// Before
const supabase = await createClient()
const { data: { user } } = await supabase.auth.getUser()
if (!user) { return NextResponse.json({ error: 'User is not authenticated', code: 401 }, { status: 401 }) }

// After
import { getRequiredUserId } from '@/lib/auth-session'
// ...
let userId: string
try {
  userId = await getRequiredUserId()
} catch {
  return NextResponse.json({ error: 'User is not authenticated', code: 401 }, { status: 401 })
}
```

Replace `user.id` with `userId` in the upsert call. Remove the `createClient` import and add `getRequiredUserId` import. The rest of the route stays unchanged.

- [ ] **Step 3: Update `src/app/api/auth/spotify/disconnect/route.ts`**

```ts
// Before
const supabase = await createClient()
const { data: { user } } = await supabase.auth.getUser()
if (!user) { return NextResponse.json({ error: 'Unauthorized', code: 401 }, { status: 401 }) }
const { error } = await supabase.from('spotify_tokens').delete().eq('user_id', user.id)

// After
import { getRequiredUserId } from '@/lib/auth-session'
import { createAdminClient } from '@/lib/supabase/admin'
// ...
let userId: string
try {
  userId = await getRequiredUserId()
} catch {
  return NextResponse.json({ error: 'Unauthorized', code: 401 }, { status: 401 })
}
const supabase = createAdminClient()
const { error } = await supabase.from('spotify_tokens').delete().eq('user_id', userId)
```

- [ ] **Step 4: Update sync and import routes**

Read `src/app/api/spotify/playlists/[id]/sync/route.ts` and `import/route.ts`. Apply the same pattern:
- Replace `supabase.auth.getUser()` with `getRequiredUserId()`
- Replace `createClient()` (for DB operations) with `createAdminClient()`
- Replace calls to `getSpotifyAccessToken(supabase)` with `getSpotifyAccessToken(userId)`

- [ ] **Step 5: Run TypeScript check**

```bash
npm run build 2>&1 | grep "error TS" | head -30
```

- [ ] **Step 6: Commit**

```bash
.meridian/meridian-agent git add src/lib/spotifyAuth.ts src/app/api/auth/spotify/ src/app/api/spotify/
.meridian/meridian-agent git commit -m "feat: replace Supabase auth in Spotify routes with Better Auth session"
```

---

## Task 11: Update remaining server pages and dev-login

**Files:**
- Modify: `src/app/join/[code]/page.tsx`
- Modify: `src/app/bands/[id]/page.tsx`
- Modify: `src/app/api/auth/dev-login/route.ts`

- [ ] **Step 1: Update `src/app/join/[code]/page.tsx`**

Read the file. Replace `supabase.auth.getUser()` with `getSession()` from `@/lib/auth-session`:

```ts
import { getSession } from '@/lib/auth-session'
// ...
const session = await getSession()
const user = session?.user ?? null
```

Replace `user.id` with `session.user.id` in subsequent DB calls. Replace `createClient()` (for DB) with `createAdminClient()`.

- [ ] **Step 2: Update `src/app/bands/[id]/page.tsx`**

Same pattern as above: `getSession()` → `session.user.id` → `createAdminClient()`.

- [ ] **Step 3: Update `src/app/api/auth/dev-login/route.ts`**

Read the file. It currently calls `supabase.auth.signInWithPassword()`. Replace with Better Auth's sign-in API:

```ts
import { auth } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not available in production' }, { status: 403 })
  }

  const email = process.env.NEXT_PUBLIC_DEV_USER_EMAIL!
  const password = process.env.NEXT_PUBLIC_DEV_USER_PASSWORD!
  const next = request.nextUrl.searchParams.get('next') ?? '/'

  // Sign in via Better Auth internal API
  const signInResponse = await auth.api.signInEmail({
    body: { email, password },
    headers: request.headers,
    asResponse: true,
  })

  if (!signInResponse.ok) {
    return NextResponse.json({ error: 'Dev login failed' }, { status: 401 })
  }

  // Forward the Set-Cookie headers from Better Auth to the client
  const response = NextResponse.redirect(new URL(next, request.url))
  signInResponse.headers.getSetCookie().forEach((cookie) => {
    response.headers.append('Set-Cookie', cookie)
  })
  return response
}
```

- [ ] **Step 4: Run TypeScript check and fix remaining errors**

```bash
npm run build 2>&1 | grep "error TS"
```

Fix any remaining call sites that still use old function signatures.

- [ ] **Step 5: Commit**

```bash
.meridian/meridian-agent git add src/app/join/ src/app/bands/ src/app/api/auth/dev-login/
.meridian/meridian-agent git commit -m "feat: replace Supabase auth in join, bands, and dev-login with Better Auth"
```

---

## Task 12: Smoke-test the full auth flow

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

- [ ] **Step 2: Test signup flow**

Visit `http://localhost:3000/signup`. Create a new account. Expected: success message + redirect to `/`.

- [ ] **Step 3: Test login/logout flow**

Log out. Visit `http://localhost:3000/login`. Sign in with the new account. Expected: redirect to `/`.

- [ ] **Step 4: Test repertoire loads**

After login, the main page should show the user's repertoire (empty for new account). Expected: no errors, empty state shown.

- [ ] **Step 5: Test route protection**

Clear cookies. Visit `http://localhost:3000/`. Expected: redirect to `/login`.

- [ ] **Step 6: Run tests**

```bash
npm test -- --run
```

Expected: all existing tests pass (they test pure lib utilities, not auth).

---

## Task 13: Create user migration script

**Files:**
- Create: `scripts/migrate-auth.ts`

- [ ] **Step 1: Create the script**

```ts
import { createClient } from '@supabase/supabase-js'
import { Pool } from 'pg'
import { randomUUID } from 'crypto'

// Reads existing users from Supabase auth.users and inserts them into
// Better Auth tables. Idempotent: skips users that already exist.

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const databaseUrl = process.env.DATABASE_URL

  if (!supabaseUrl || !serviceRoleKey || !databaseUrl) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or DATABASE_URL')
  }

  // Supabase admin client — reads from auth.users
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // Direct PostgreSQL connection — writes to Better Auth tables
  const pool = new Pool({ connectionString: databaseUrl })

  console.log('Fetching users from Supabase auth.users...')
  const { data: authUsers, error } = await supabase.auth.admin.listUsers()
  if (error) throw new Error(`Failed to list Supabase users: ${error.message}`)

  console.log(`Found ${authUsers.users.length} user(s). Starting migration...`)

  for (const authUser of authUsers.users) {
    const client = await pool.connect()
    try {
      // Check if user already exists in Better Auth
      const existing = await client.query(
        `SELECT id FROM "user" WHERE id = $1`,
        [authUser.id]
      )

      if (existing.rows.length > 0) {
        console.log(`  ↳ ${authUser.email} — already migrated, skipping.`)
        continue
      }

      await client.query('BEGIN')

      // Insert into Better Auth "user" table
      await client.query(
        `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          authUser.id,
          authUser.user_metadata?.full_name ?? authUser.email?.split('@')[0] ?? 'User',
          authUser.email,
          authUser.email_confirmed_at != null,
          authUser.created_at ?? new Date().toISOString(),
          authUser.updated_at ?? new Date().toISOString(),
        ]
      )

      // Insert credential account (email/password) into Better Auth "account" table
      // Supabase stores bcrypt hash in encrypted_password — Better Auth uses the same field
      if (authUser.encrypted_password) {
        await client.query(
          `INSERT INTO "account" (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
           VALUES ($1, $2, 'credential', $3, $4, $5, $6)`,
          [
            randomUUID(),
            authUser.email,
            authUser.id,
            authUser.encrypted_password,
            authUser.created_at ?? new Date().toISOString(),
            authUser.updated_at ?? new Date().toISOString(),
          ]
        )
      }

      await client.query('COMMIT')
      console.log(`  ✓ ${authUser.email} — migrated.`)
    } catch (err) {
      await client.query('ROLLBACK')
      console.error(`  ✗ ${authUser.email} — failed:`, err)
      throw err
    } finally {
      client.release()
    }
  }

  await pool.end()
  console.log('Migration complete.')
}

main().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})
```

- [ ] **Step 2: Run the migration locally**

```bash
npx tsx scripts/migrate-auth.ts
```

Expected output:
```
Fetching users from Supabase auth.users...
Found 2 user(s). Starting migration...
  ✓ user1@example.com — migrated.
  ✓ user2@example.com — migrated.
Migration complete.
```

- [ ] **Step 3: Run again to verify idempotency**

```bash
npx tsx scripts/migrate-auth.ts
```

Expected output:
```
  ↳ user1@example.com — already migrated, skipping.
  ↳ user2@example.com — already migrated, skipping.
Migration complete.
```

- [ ] **Step 4: Verify migrated users can log in**

Try logging in with both existing accounts. Expected: login succeeds, same password works.

- [ ] **Step 5: Commit**

```bash
.meridian/meridian-agent git add scripts/migrate-auth.ts
.meridian/meridian-agent git commit -m "feat: add idempotent auth migration script (Supabase auth.users → Better Auth)"
```

---

## Task 14: Add migration step to CI + configure Vercel env vars

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Add `migrate-users` job to CI**

The current `ci.yml` delegates everything to a reusable workflow. Add a new job that runs after `build` and only on pushes to `master` (not on PRs — PRs don't have production DB access):

```yaml
name: "Node.js CI"

on:
  push:
    branches: [ "main", "master" ]
  pull_request:
    branches: [ "main", "master" ]

jobs:
  build:
    uses: heitorpolidoro/.github/.github/workflows/node-ci.yml@master
    with:
      node-versions: "['24.x']"
      sonar-node-version: "24.x"
      database: supabase
    secrets: inherit # pragma: allowlist secret

  # TEMPORARY: migrate Supabase auth.users → Better Auth tables.
  # Remove this job once all users are confirmed migrated.
  migrate-users:
    needs: build
    runs-on: ubuntu-latest
    if: github.event_name == 'push' && (github.ref == 'refs/heads/master' || github.ref == 'refs/heads/main')
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '24.x'
          cache: 'npm'
      - run: npm ci
      - name: Run auth migration (idempotent)
        run: npx tsx scripts/migrate-auth.ts
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
          NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.NEXT_PUBLIC_SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
```

- [ ] **Step 2: Add secrets to GitHub repository**

Go to your GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**.

Add:
- `DATABASE_URL` — the direct PostgreSQL connection string from Task 1
- `BETTER_AUTH_SECRET` — the secret generated in Task 1

(`NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` should already exist from the Supabase CI setup.)

- [ ] **Step 3: Add env vars to Vercel**

```bash
vercel env add BETTER_AUTH_SECRET production
# paste the secret when prompted

vercel env add BETTER_AUTH_URL production
# value: https://your-production-domain.vercel.app

vercel env add NEXT_PUBLIC_APP_URL production
# value: https://your-production-domain.vercel.app

vercel env add DATABASE_URL production
# paste the Supabase PostgreSQL connection string
```

- [ ] **Step 4: Commit CI change**

```bash
.meridian/meridian-agent git add .github/workflows/ci.yml
.meridian/meridian-agent git commit -m "chore: add temporary migrate-users CI job for Better Auth migration"
```

- [ ] **Step 5: Open a PR, verify CI passes, merge**

```bash
.meridian/meridian-agent gh pr create --title "feat: replace Supabase Auth with Better Auth" --body "Migrates authentication from Supabase Auth to Better Auth. Database and RLS tables unchanged. Includes idempotent user migration script in CI." --label "minor"
```

- [ ] **Step 6: After merge, verify migration ran in CI**

Check the GitHub Actions run for the `migrate-users` job. Confirm both users migrated successfully.

- [ ] **Step 7: Remove migration job from CI (cleanup)**

After confirming migration is complete, open a follow-up PR to remove the `migrate-users` job from `ci.yml`.

---

## Notes

**Profile trigger:** Supabase likely has a DB trigger on `auth.users` INSERT that creates a row in `profiles`. Since new users now come from Better Auth's `"user"` table (not `auth.users`), this trigger won't fire for new signups. Check `supabase/migrations/` for any `CREATE TRIGGER ... ON auth.users` — if found, move the profile creation logic to the signup flow (call `createProfile(userId, name)` after `authClient.signUp.email()`).

**Instrument data on signup:** The signup page currently passes `instruments` and `primary_instrument` as Supabase user metadata. Since Better Auth doesn't support custom metadata on signup, update the signup flow to call `updateProfile(userId, { instruments, primary_instrument })` immediately after successful signup (as a Server Action).

**Cleanup (future):** Once the migration is stable, the Supabase Auth tables (`auth.users`, `auth.sessions`, etc.) can be cleared. Do not delete them — they're managed by Supabase internally and cannot be dropped.
