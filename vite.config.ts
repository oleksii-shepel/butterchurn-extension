// vite.config.ts
import { defineConfig } from 'vite';
import { resolve } from 'path'; // Needed for path.resolve

export default defineConfig({
  build: {
    outDir: 'dist', // Output directory for all built files
    emptyOutDir: true, // Clears the output directory before building
    minify: false,
    sourcemap: true,
    rollupOptions: {
      input: {
        content: resolve(__dirname, 'src/content.ts'),
        sandbox: resolve(__dirname, 'src/sandbox.ts'),
      },
      output: {
        // This pattern ensures each entry file gets its own name in the dist folder
        entryFileNames: '[name].js',
        // Preserve asset filenames (like images, if you add them later)
        assetFileNames: 'assets/[name].[ext]',
      },
    },
  },
});