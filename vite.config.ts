import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the built app works from any folder/subpath
  // (plain Nginx/Apache, file previews, and Tauri all serve it fine).
  base: './',
  server: {
    watch: {
      // Never watch the Rust build output: cargo holds locks on artifacts
      // (EBUSY on Windows) and crashes the dev server during `tauri dev`.
      ignored: ['**/src-tauri/**']
    }
  },
  build: {
    outDir: 'dist',
    target: 'es2020',
    sourcemap: false
  },
  test: {
    environment: 'node'
  }
} as never);
