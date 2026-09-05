import type { NextConfig } from "next";
import pkg from "./package.json";

const nextConfig: NextConfig = {
  output: process.env.VERCEL ? undefined : "standalone",
  allowedDevOrigins: ['127.0.0.1'],
  reactCompiler: true,
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
  },
  experimental: {
    serverActions: {
      // Must stay above the 10MB tab-upload limit enforced in
      // src/app/actions/tabs.ts, plus multipart overhead.
      bodySizeLimit: '12mb',
    },
  },
  // RH-32: `better-auth` MUST NOT be listed here. serverExternalPackages leaves a package
  // unbundled, so `better-auth/react` would load its own copy of `react` at runtime instead of
  // Next's vendored SSR React — the hook dispatcher is null in that copy and
  // `authClient.useSession()` crashes every SSR render with
  // "Cannot read properties of null (reading 'useRef')". Only Node-only packages with no React
  // entrypoint belong in this list. Guarded by
  // src/lib/__tests__/serverExternalPackages.test.ts.
  serverExternalPackages: ["@better-auth/kysely-adapter", "kysely", "pg"],
  // Next.js 16 defaults to Turbopack. Our webpack config only suppresses
  // OpenTelemetry warnings (irrelevant in Turbopack). Declaring an empty
  // turbopack config silences the "webpack config without turbopack config" error.
  turbopack: {},
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Suppress "Critical dependency" warnings from OpenTelemetry packages
      // bundled transitively through @sentry/node (they use dynamic require).
      config.ignoreWarnings = [
        ...(config.ignoreWarnings ?? []),
        { module: /@opentelemetry\/instrumentation/ },
        { module: /@prisma\/instrumentation/ },
        { module: /@fastify\/otel/ },
      ];
    }
    return config;
  },
};

export default nextConfig;
