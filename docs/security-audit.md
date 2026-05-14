# Security Audit — Repertoire Hero

**Date:** 2026-05-13
**Scope:** Supabase RLS policies, application data layer, dev-login mechanism
**Files reviewed:**
- `supabase/migrations/20240101000000_initial_schema.sql`
- `src/lib/songs.ts`
- `src/types/database.ts`
- `src/middleware.ts`
- `src/app/api/auth/dev-login/route.ts`
- `.env.example`, `.env.local.example`

---

## Summary of Findings

| ID | Severity | Title | Status |
|----|----------|-------|--------|
| F1 | Critical | No RLS policies for `global_songs` INSERT/UPDATE — app writes were broken and unsafe | Fixed |
| F2 | High | Silent no-op on cross-user `user_repertoire` mutations (no row-count check) | Fixed |
| F3 | High | Open redirect in `/api/auth/dev-login` via unvalidated `next` parameter | Fixed |
| F4 | Medium | `NEXT_PUBLIC_DEV_*` variables embed credentials in the JS bundle | Recommendation |
| F5 | Low | No `profiles` DELETE policy — users cannot self-delete (acceptable, undocumented) | Recommendation |
| F6 | Info | `NEXT_PUBLIC_AUTO_LOGIN` guard is runtime only — cannot be tree-shaken at build time | Recommendation |
| F7 | Info | `.env.local.example` contains a real email address | Recommendation |

---

## Findings and Fixes Applied

### F1 — Critical: Missing `global_songs` INSERT/UPDATE RLS policies

**Threat:** Vertical privilege escalation. The migration comment stated that write operations were "restricted to service-role," but `src/lib/songs.ts` called `supabase.from('global_songs').insert(...)` and `.update(...)` using the anon/user JWT from the browser client. Because no INSERT or UPDATE policy existed for the `authenticated` role, Supabase denied these operations entirely, making `createAndAddSong` and `updateSong` silently broken in production (all writes returned a permission error). Had the policies been misconfigured to be permissive, any user could have overwritten any song in the shared catalogue.

**Fix applied:**

1. Added an `owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL` column to `global_songs`.
2. Added an INSERT policy requiring `owner_id = auth.uid()` — users can only insert rows they own.
3. Added an UPDATE policy requiring `owner_id = auth.uid()` on both `USING` and `WITH CHECK` — only the creator may edit a song's metadata.
4. DELETE remains intentionally blocked for client users; service-role is used for admin removals.
5. Updated `createAndAddSong` in `src/lib/songs.ts` to resolve `auth.getUser()` and set `owner_id` on insert, satisfying the new RLS policy.

Migration file: `supabase/migrations/20240101000000_initial_schema.sql`
Application file: `src/lib/songs.ts`

---

### F2 — High: Silent no-op on cross-user `user_repertoire` mutations

**Threat:** Horizontal privilege escalation (app-layer). The RLS policies for `user_repertoire` UPDATE and DELETE correctly enforce `user_id = auth.uid()`, so the database will never mutate another user's rows. However, the app functions (`updateSongStatus`, `updateSongTags`, `updatePersonalKey`, `removeSongFromRepertoire`) did not check the affected row count. If a caller passed a `repertoireId` belonging to another user, the DB would return success with 0 rows affected, and the app would silently succeed. An attacker could probe UUIDs without any error feedback, and the UI would render a false success.

**Fix applied:** Added `.select('id', { count: 'exact', head: true })` to all four mutating functions and throw an `'access denied'` error when `count === 0`.

Application file: `src/lib/songs.ts`

---

### F3 — High: Open redirect in `/api/auth/dev-login`

**Threat:** The `next` query parameter was used directly as the redirect pathname without validation. An attacker could craft a URL like `/api/auth/dev-login?next=//evil.com/phish` to redirect a victim to an external site after authentication. Although the endpoint returns 404 when `NEXT_PUBLIC_AUTO_LOGIN !== 'true'`, the guard is runtime-only and a misconfiguration would expose this path.

**Fix applied:** Added validation requiring `next` to be a relative path starting with `/` and not starting with `//`.

```ts
const safeNext = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/'
```

Application file: `src/app/api/auth/dev-login/route.ts`

---

## Remaining Recommendations

### F4 — Medium: `NEXT_PUBLIC_DEV_*` variables embed credentials in the JS bundle

Variables prefixed with `NEXT_PUBLIC_` are inlined into the browser JavaScript bundle at build time. If `NEXT_PUBLIC_DEV_USER_EMAIL` or `NEXT_PUBLIC_DEV_USER_PASSWORD` are set in a production build (even accidentally), the credentials will be visible in the client-side bundle.

**Recommendation:** Rename these to `DEV_USER_EMAIL` / `DEV_USER_PASSWORD` (no `NEXT_PUBLIC_` prefix) and read them only in the server-side route handler `src/app/api/auth/dev-login/route.ts`. The middleware check for `NEXT_PUBLIC_AUTO_LOGIN` can remain public since it controls UI behavior. Update `.env.example` accordingly.

---

### F5 — Low: No `profiles` DELETE policy

Users cannot delete their own profile row through the client. This is acceptable for this application (a CASCADE from `auth.users` handles hard deletes when Supabase Auth deletes the account), but it is undocumented.

**Recommendation:** Add a comment to the migration explaining this is intentional and that profile cleanup happens via the `ON DELETE CASCADE` constraint.

---

### F6 — Info: `NEXT_PUBLIC_AUTO_LOGIN` cannot be tree-shaken at build time

The dev-login route checks `process.env.NEXT_PUBLIC_AUTO_LOGIN !== 'true'` at runtime. Next.js embeds `NEXT_PUBLIC_*` values at build time, so the dead-code branch will be in the production bundle. This is not a direct vulnerability but increases the attack surface.

**Recommendation:** Consider using a `middleware.ts` build condition or a separate route file that is excluded from production builds via `next.config.js` rewrites, so the route does not exist at all in production.

---

### F7 — Info: Real email address in `.env.local.example`

`/Users/heitor/workspace/repertoire_hero/.env.local.example` contains `heitor.polidoro@gmail.com`. This file is currently not tracked by git (the `.gitignore` rule `.env*` covers it). However, if it were ever committed to a public repository, it would expose the developer's email.

**Recommendation:** Replace with a placeholder value such as `dev@example.com` in the example file.

---

## Auto-Login Bypass Risk Assessment

The `NEXT_PUBLIC_AUTO_LOGIN` feature cannot be exploited in production provided:

1. The environment variable is set to `false` (or absent) in the production deployment.
2. `NEXT_PUBLIC_DEV_USER_EMAIL` / `NEXT_PUBLIC_DEV_USER_PASSWORD` are not set in production.

The route handler returns HTTP 404 when `AUTO_LOGIN !== 'true'`, and the middleware only triggers the auto-login redirect when the flag is `'true'`. As long as these variables are absent from the production environment, the feature is inert. The open-redirect fix (F3) provides defense-in-depth even if the flag were accidentally enabled.

No additional controls are required beyond confirming these variables are absent from the production CI/CD environment and Supabase dashboard settings.

---

## SECURITY DEFINER Function Assessment

`handle_new_user()` is declared with `SECURITY DEFINER` and `SET search_path = public`. The function:

- Is triggered only on `INSERT` to `auth.users` (a Supabase-internal table not writable by anon/authenticated roles).
- Writes only to `public.profiles` with the `NEW.id`, `NEW.email`, and `NEW.raw_user_meta_data ->> 'full_name'` values — all sourced from the trusted `auth.users` row.
- Uses `ON CONFLICT (id) DO NOTHING` to prevent duplicate rows.
- The `search_path` pin prevents schema-injection attacks.

No unintended write paths identified. The function is correctly scoped.

---

## Sign-Off

Audit completed by the DevSecOps agent on 2026-05-13. All Critical and High findings have been remediated in the codebase. Medium, Low, and Info findings are documented above as recommendations for the developer's consideration.
