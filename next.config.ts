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
};

export default nextConfig;
