/** @type {import('next').NextConfig} */
const nextConfig = {
  // msedge-tts opens a Node WebSocket at runtime and must not be bundled by Next.js.
  serverExternalPackages: ["msedge-tts"],
};

export default nextConfig;
