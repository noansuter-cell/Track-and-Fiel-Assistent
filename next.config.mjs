// NEXT_PUBLIC_BASE_PATH is set by the GitHub Pages workflow (the app is
// served under /<repo-name>/ there); locally it stays empty.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  basePath,
  reactStrictMode: true,
};

export default nextConfig;
