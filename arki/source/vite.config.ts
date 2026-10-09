import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The built app is written to the parent folder (arki/), which is what GitHub Pages
// serves at wndx2.github.io/arki. Paths are relative so it works from that sub-folder.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: '..',
    // The parent folder also holds this source folder, so it must never be emptied;
    // the build script clears the previous build's files itself.
    emptyOutDir: false,
  },
});
