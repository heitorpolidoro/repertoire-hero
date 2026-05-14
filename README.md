# Repertoire Hero

Repertoire Hero is a web application that helps musicians build and track their practice repertoire. It lets you add songs, set target tempos, log practice sessions, and visualize your progress over time.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS v4 |
| State | Zustand |
| Database | Supabase (PostgreSQL) |
| Auth | Supabase Auth |
| Testing | Vitest |

## Local Setup

```bash
# 1. Clone the repository
git clone https://github.com/your-org/repertoire_hero.git
cd repertoire_hero

# 2. Copy environment variables and fill in your values
cp .env.example .env.local

# 3. Install dependencies
npm install

# 4. Start the development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Supabase Setup

1. Create a new project at [supabase.com](https://supabase.com).
2. Copy the **Project URL** and **anon public key** from _Project Settings > API_ into your `.env.local`.
3. Run the database migrations:

```bash
npx supabase db push
```

4. Seed the database with sample data:

```bash
npx supabase db seed
```

> If you prefer to run migrations manually, apply the SQL files in `supabase/migrations/` in chronological order, then run `supabase/seed.sql`.

## Running Tests

```bash
# Single run (used in CI)
npm test

# Watch mode
npm run test:watch
```

## Environment Variables

See `.env.example` for a full list of required variables with descriptions. Add your actual values to `.env.local` (never commit this file).

## Deployment

The project is deployed on Vercel. Every merge to `main` triggers an automatic production deployment. See `.github/workflows/ci.yml` for the CI pipeline and `vercel.json` for the build configuration.

Required secrets in the Vercel dashboard:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
