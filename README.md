This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Local development

Step one for everyone, runner or not — Docker Compose reads `.env` in *every*
subcommand, so the file has to exist:

```bash
cp .env.example .env
cp .env.example .env.local   # the host-side tooling (migrations, vitest) reads this one
```

**Standalone** — the repo starts its own PostgreSQL and the app container next
to it. The bundled database publishes `${POSTGRES_PORT:-54322}`; override the
port inline when 54322 is already taken on your machine:

```bash
COMPOSE_PROFILES=standalone POSTGRES_PORT=54323 docker compose up -d --wait
curl -o /dev/null -w '%{http_code}\n' http://localhost:3000/   # 200
```

**Shared Postgres via [poli-runner](../polidoro-runner/README.md)** — the
bundled database stays down and the app points at the shared cluster's
`repertoire_hero` database instead (wired from `poli-runner.yml`):

```bash
poli-runner start repertoire_hero
```

Seed a local database with dev users and the shared song catalogue
(`scripts/seed-catalog.sql`); it targets `DATABASE_URL`, or takes the connection
string as an argument:

```bash
npm run seed
```

Run the tests. The database-backed suites are opt-in behind `RUN_DB_TESTS`, and
they need a live, migrated PostgreSQL at `DATABASE_URL`; without it they skip
and vitest prints a warning saying so:

```bash
npx vitest run                 # unit suites only — DB-backed files skip
RUN_DB_TESTS=1 npx vitest run  # the full suite
```

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
