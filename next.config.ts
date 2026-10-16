import path from 'node:path';
import type { NextConfig } from 'next';

/**
 * The renderer is a static SPA. All privileged work (audio, STT, injection,
 * hotkeys) lives in the Electron main process and is reached over IPC, so there
 * is nothing here that needs a server at runtime.
 *
 * In production the exported `out/` directory is served by a tiny HTTP server
 * inside the main process rather than loaded over `file://`. That keeps the app
 * router's client-side navigation, the AudioWorklet module fetch and relative
 * asset URLs all behaving normally.
 */
const nextConfig: NextConfig = {
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: false, // the mic pipeline is imperative; double-mount is noise here

  // `src/shared` is imported by both the Electron build and the renderer. The
  // main-process bundle resolves it via tsconfig paths; Next needs its own map.
  turbopack: {
    resolveAlias: {
      '@shared/types': './src/shared/types.ts',
      '@shared/ipc': './src/shared/ipc.ts',
      '@shared/merge': './src/shared/merge.ts',
      '@shared': './src/shared',
    },
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      '@shared': path.resolve(__dirname, 'src/shared'),
      '@': path.resolve(__dirname, 'src'),
    };
    return config;
  },
};

export default nextConfig;
