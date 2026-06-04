import type { NextConfig } from "next";
import pkg from "./package.json";

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: ['127.0.0.1'],
  reactCompiler: true,
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
  },
  serverExternalPackages: ["better-auth", "@better-auth/kysely-adapter", "kysely", "pg"],
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
