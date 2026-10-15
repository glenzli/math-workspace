import * as path from 'node:path';
import { build, defineConfig } from 'vite';
import { copyPublicationPdfRuntime } from './src/publication/pdf-runtime';
import { finalizeFormulaRuntime } from './src/reader/formula-runtime';

function formulaRuntimePlugin() {
    let output = '';
    return {
        name: 'optional-formula-runtime',
        apply: 'build' as const,
        configResolved(config: any) { output = path.resolve(config.root, config.build.outDir); },
        async closeBundle() {
            await build({ configFile: false, root: __dirname,
                resolve: { alias: [{ find: /^#default-font\/svg\/default\.js$/, replacement: path.resolve(__dirname, 'src/reader/web/reader-formula-tex-font.ts') }] },
                build: { outDir: path.join(output, 'mathjax'), emptyOutDir: true, target: 'es2022', sourcemap: false, minify: true,
                    lib: { entry: path.resolve(__dirname, 'src/reader/web/reader-formula-reflow-runtime.ts'), formats: ['es'], fileName: () => 'mathjax-tex-svg.mjs' },
                    rollupOptions: { output: { inlineDynamicImports: true } } }
            });
            await finalizeFormulaRuntime(output, path.resolve(__dirname, 'node_modules'), path.resolve(__dirname, 'media/licenses/mathjax-tex-font-OFL.txt'));
        }
    };
}

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
    plugins: [publicationPdfRuntimePlugin(), formulaRuntimePlugin()],
    build: {
        outDir: path.resolve(__dirname, 'out/reader'),
        emptyOutDir: true,
        target: 'es2022',
        sourcemap: false,
        minify: true
    }
});
