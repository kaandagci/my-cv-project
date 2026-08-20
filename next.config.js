/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['pdf-parse', '@react-pdf/renderer'],
    // Ensure the embedded Turkish-support fonts are bundled into the
    // generate-pdf serverless function on Vercel. Without this, Vercel's
    // file tracer can miss files loaded via a dynamically-built fs path
    // (path.join(process.cwd(), 'fonts', ...)), causing "font file not
    // found" errors in production even though it works locally.
    outputFileTracingIncludes: {
      '/api/generate-pdf': ['./fonts/**']
    }
  }
};

module.exports = nextConfig;
