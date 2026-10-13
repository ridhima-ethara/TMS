const nextConfig = {
  // Keep development and production artifacts isolated. This prevents another
  // Next.js process in the same workspace from replacing runtime manifests.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  poweredByHeader: false,
  output: 'standalone',
  outputFileTracingRoot: __dirname,
  images: {
    unoptimized: true,
    localPatterns: [
      {
        pathname: '/brand/ethara-mark-animation.svg',
        search: '?ctx=signin',
      },
      {
        pathname: '/brand/ethara-mark-animation.svg',
        search: '?ctx=register',
      },
    ],
    remotePatterns: [
      { protocol: 'https', hostname: 'avatars.githubusercontent.com', pathname: '/**' },
    ],
  },
  serverExternalPackages: ['pg', 'nodemailer'],
  experimental: {
    // This host has 2 vCPUs / 3.7 GB shared with the live server; one build
    // worker and webpack's memory optimisations keep a production build from
    // starving it (see scripts/deploy.sh and scripts/tms-guard.sh).
    cpus: 1,
    webpackMemoryOptimizations: true,
  },
  webpack(config, { dev }) {
    if (dev) {
      // Reduce CPU/memory from file watching
      config.watchOptions = {
        poll: 2000, // check every 2 seconds
        aggregateTimeout: 300, // wait before rebuilding
        ignored: ['**/node_modules'],
      };
    }
    return config;
  },
  onDemandEntries: {
    maxInactiveAge: 10000,
    pagesBufferLength: 2,
  },
  async headers() {
    // Next's dev runtime evaluates module code and opens an HMR websocket, so
    // development needs 'unsafe-eval' and a ws: connect-src. Production keeps
    // the strict policy - never relax these two for a deployed build.
    const isDev = process.env.NODE_ENV !== 'production';
    const scriptSrc = `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`;
    const connectSrc = `connect-src 'self'${isDev ? ' ws: wss:' : ''}`;
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: `default-src 'self'; ${scriptSrc}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://avatars.githubusercontent.com; font-src 'self' data:; ${connectSrc}; media-src 'self'; worker-src 'self' blob:; frame-src 'none'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self';` },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
          { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
