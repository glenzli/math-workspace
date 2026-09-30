import * as path from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
    root: path.resolve(__dirname, 'src/reader/web'),
    base: './',
    build: {
        outDir: path.resolve(__dirname, 'out/reader'),
        emptyOutDir: true,
        target: 'es2022',
        sourcemap: false,
        minify: true
    }
});
