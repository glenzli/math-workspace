import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const formalId = index => `h-${index.toString(16).padStart(16, '0')}`;

export async function testLeanFlowPerformance({ baseline = false } = {}) {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'math-workspace-lean-flow-'));
    let review;
    const originalRead = fs.readFile, originalReaddir = fs.readdir;
    try {
        const bundle = path.join(temporary, 'services.cjs');
        await build({ stdin: { contents: `export { LeanReviewService } from '${repoRoot}/src/lean/lean-review-service';
            export { LeanAuditService } from '${repoRoot}/src/lean/lean-audit-service';`, resolveDir: repoRoot },
            bundle: true, platform: 'node', format: 'cjs', outfile: bundle,
            tsconfig: path.join(repoRoot, 'tsconfig.cli.json'), logLevel: 'silent' });
        let root = path.join(temporary, 'project');
        await fs.mkdir(path.join(root, '.math-workspace'), { recursive: true });
        await fs.mkdir(path.join(root, 'book'), { recursive: true });
        await fs.mkdir(path.join(root, 'lean'), { recursive: true });
        root = await fs.realpath(root);
        await fs.writeFile(path.join(root, '.math-workspace/config.json'), JSON.stringify({ lean: { projects: [
            { key: 'fixture', root: 'lean', sourceRoots: ['.'], target: 'Fixture', module: 'Fixture' }
        ] } }));
        await fs.writeFile(path.join(root, 'lean/lean-toolchain'), 'leanprover/lean4:v4.33.1\n');
        await fs.writeFile(path.join(root, 'lean/lakefile.toml'), 'name = "flow-fixture"\n');
        const leanFile = path.join(root, 'lean/Fixture.lean');
        const chapter = 'book/01-flow.md';
        const count = 160;
        await fs.writeFile(path.join(root, chapter), '# Flow\n\n' + Array.from({ length: count }, (_, i) =>
            `定理 #${formalId(i + 1)}（Claim ${i + 1}）：For every n, n = n.\n\n证明：Reflexivity.\n证毕。\n`).join('\n'));
        await fs.writeFile(leanFile, 'namespace Fixture\n' + Array.from({ length: count }, (_, i) =>
            `/-- Math Workspace anchor: ${formalId(i + 1)}\n${'Source context. '.repeat(24)}-/\ntheorem claim_${i + 1} (n : Nat) : n = n := rfl\n`).join('\n') + 'end Fixture\n');
        const { LeanReviewService, LeanAuditService } = require(bundle);
        review = new LeanReviewService();
        const audit = new LeanAuditService(review);
        let sourceReads = 0, markdownReads = 0, readBytes = 0, directoryReads = 0;
        fs.readFile = async function (file, ...args) {
            const data = await originalRead.call(this, file, ...args);
            if (String(file).startsWith(root + path.sep)) {
                readBytes += Buffer.byteLength(data);
                if (String(file) === leanFile) sourceReads++;
                if (String(file) === path.join(root, chapter)) markdownReads++;
            }
            return data;
        };
        fs.readdir = async function (directory, ...args) {
            if (String(directory).startsWith(root)) directoryReads++;
            return originalReaddir.call(this, directory, ...args);
        };
        const started = performance.now();
        const [object, sourceAudit, queue] = await Promise.all([
            review.get(root, formalId(1)), audit.get(root, formalId(1)), review.queue(root, chapter)
        ]);
        const measurement = { objects: count, milliseconds: Math.round(performance.now() - started),
            sourceReads, markdownReads, readBytes, directoryReads };
        console.log(`Lean flow concurrent object/audit/queue: ${JSON.stringify(measurement)}`);
        assert.equal(queue.items.length, count);
        assert.equal(object.evidence.fingerprint, sourceAudit.evidenceFingerprint);
        assert.equal(object.evidence.fingerprint, queue.items[0].evidenceFingerprint);
        assert.equal(object.evidence.state, 'unavailable');
        assert.equal(object.review.freshness, 'unreviewed');
        if (!baseline) {
            assert.ok(sourceReads <= 4, `A shared Lean source must not be reread for each object: ${sourceReads}`);
            assert.ok(markdownReads <= 2, `Concurrent passive consumers must share the workspace scan: ${markdownReads}`);
            const previousFingerprint = object.evidence.fingerprint;
            await fs.appendFile(leanFile, '\n-- immediate input change\n');
            const changed = await review.get(root, formalId(1));
            assert.notEqual(changed.evidence.fingerprint, previousFingerprint,
                'A completed read batch must not hide later disk edits behind a TTL cache.');
            const currentMarkdown = await originalRead(path.join(root, chapter), 'utf8');
            await fs.writeFile(path.join(root, chapter), currentMarkdown.replace('For every n, n = n.', 'For every m, m = m.'));
            const displayed = await review.get(root, formalId(1));
            assert.match(displayed.evidence.statement.content, /every m/);

            // Hold one passive scan after it has read the old Markdown. A write admission
            // must bypass that in-flight batch rather than accepting its earlier evidence.
            let releaseRead, scanned, barrierTimeout;
            const paused = new Promise(resolve => { scanned = resolve; });
            const release = new Promise(resolve => { releaseRead = resolve; });
            const measuredRead = fs.readFile;
            let held = false;
            fs.readFile = async function (file, ...args) {
                const data = await measuredRead.call(this, file, ...args);
                if (!held && String(file) === path.join(root, chapter)) {
                    held = true; scanned(); await release;
                }
                return data;
            };
            const earlier = review.get(root, formalId(1));
            try {
                await Promise.race([paused, new Promise((_, reject) => {
                    barrierTimeout = setTimeout(() => reject(new Error('The passive scan did not reach the source-read barrier.')), 5000);
                })]);
                clearTimeout(barrierTimeout);
                await fs.writeFile(path.join(root, chapter), currentMarkdown.replace('For every n, n = n.', 'For every k, k = k.'));
                const admission = await review.get(root, formalId(1), true);
                assert.match(admission.evidence.statement.content, /every k/,
                    'Fresh admission must not join a passive scan already in progress.');
                await assert.rejects(review.action(root, { action: 'save', id: object.id,
                    expectedRevision: 0, evidenceFingerprint: displayed.evidence.fingerprint,
                    verdict: 'undecided', reviewer: 'Fixture', scope: 'No semantic claim', note: '', subclaims: [] }),
                /displayed evidence changed/,
                'Saving earlier evidence during an in-flight passive scan must independently reject source drift.');
            } finally { clearTimeout(barrierTimeout); releaseRead(); fs.readFile = measuredRead; }
            assert.equal((await earlier).evidence.fingerprint, displayed.evidence.fingerprint,
                'The held passive scan must represent exactly the evidence used by the rejected save.');
            await fs.writeFile(path.join(root, '.math-workspace/config.json'), '{');
            await assert.rejects(review.get(root, formalId(1)));
            await fs.writeFile(path.join(root, '.math-workspace/config.json'), JSON.stringify({}));
            assert.equal((await review.get(root, formalId(1))).evidence.declarations.length, 0,
                'A failed read batch must be evicted so configuration recovery is visible immediately.');
        }
        return measurement;
    } finally {
        fs.readFile = originalRead; fs.readdir = originalReaddir;
        await review?.close();
        await fs.rm(temporary, { recursive: true, force: true });
    }
}
