import * as path from 'node:path';
import { defineConfig } from 'vite';
import { copyPublicationPdfRuntime } from './src/publication/pdf-runtime';

function publicationPdfRuntimePlugin() {
    let output = '';
    return {
        name: 'publication-pdf-runtime',
        apply: 'build' as const,
        configResolved(config: any) { output = path.resolve(config.root, config.build.outDir); },
        async closeBundle() { await copyPublicationPdfRuntime(path.resolve(__dirname, 'node_modules/pdfjs-dist'), output); }
    };
}

export default defineConfig({
    root: path.resolve(__dirname, 'src/reader/web'),
    base: './',
    plugins: [publicationPdfRuntimePlugin()],
    build: {
        outDir: path.resolve(__dirname, 'out/reader'),
        emptyOutDir: true,
        target: 'es2022',
        sourcemap: false,
        minify: true
    }
});
