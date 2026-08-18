import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // This app sits alongside unrelated projects in the same git repository, so Next's upward
  // search for a workspace root lands on the parent directory and pulls the siblings into file
  // tracing. Pin the root to this app.
  turbopack: {
    root: dirname(fileURLToPath(import.meta.url)),
  },
};

export default nextConfig;
