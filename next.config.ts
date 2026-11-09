import type { NextConfig } from "next";
// PGlite ships WASM and must stay external to the server bundle; it is only loaded when DATABASE_URL is unset.
const nextConfig: NextConfig = { reactStrictMode: true, serverExternalPackages: ["@electric-sql/pglite"] };
export default nextConfig;
