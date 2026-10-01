/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['pdf-parse', '@react-pdf/renderer']
  }
};

module.exports = nextConfig;
