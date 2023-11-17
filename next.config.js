/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  output: 'standalone',
  webpack: (config) => {
    // refer svg in javascript, load svgr if not "?url"
    config.module.rules.push(
      {
        test: /\.svg$/i,
        issuer: /\.[jt]sx?$/,
        resourceQuery: {not: [/url/]}, // use svgr react component if NOT *.svg?url
        use: ['@svgr/webpack'],
      },
    );

    return config;
  },
  async rewrites() {
    return [
      // Rewrite chat/* to use `chat` because we use react-router there
      {
        source: '/chat/:path*',
        destination: '/chat',
      },
    ];
  },
};

module.exports = nextConfig;


// Injected content via Sentry wizard below
// for mannual setup or config, see:
// https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/?original_referrer=https%3A%2F%2Fwww.google.com%2F

const { withSentryConfig } = require("@sentry/nextjs");

module.exports = withSentryConfig(
  module.exports,
  {
    // For all available options, see:
    // https://github.com/getsentry/sentry-webpack-plugin#options

    // Suppresses source map uploading logs during build
    silent: true,

    org: "visionary-education-foundation",
    project: "app",
  },
  {
    // For all available options, see:
    // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

    // Upload a larger set of source maps for prettier stack traces (increases build time)
    widenClientFileUpload: true,

    // Transpiles SDK to be compatible with IE11 (increases bundle size)
    transpileClientSDK: false,

    // Routes browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers (increases server load)
    tunnelRoute: "/monitoring",

    // Hides source maps from generated client bundles
    hideSourceMaps: false,

    // Automatically tree-shake Sentry logger statements to reduce bundle size
    disableLogger: true,
  }
);
