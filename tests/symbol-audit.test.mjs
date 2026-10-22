import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { readerToolbarHarness } from './reader-toolbar-menu.test.mjs';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function testSymbolAuditNotation() {
    const temporary = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'symbol-audit-notation-')));
    try {
        const bundle = path.join(temporary, 'audit.cjs');
        await build({
            stdin: { contents: ['symbol-audit', 'symbol-audit-service', 'codex-symbol-audit'].map(name => `export * from './src/reader/${name}';`).join('\n') + "\nexport * from './src/mcp/workspace-queries';", resolveDir: root },
            outfile: bundle, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent', tsconfig: path.join(root, 'tsconfig.cli.json')
        });
        const api = require(bundle);
        const source = (filePath, context) => ({ filePath, content: `# Notation\n\n${context}\n`, registeredSymbols: [] });
        const raw = (expression, bindingKey, meaning, base = expression, kind = 'special') => ({
            expression, bindingKey, meaning, structure: { base, modifiers: [] }, kind,
            scope: kind === 'temporary' ? 'local' : 'book', semanticType: 'quantity',
            startLine: 3, endLine: 3, evidence: meaning, confidence: 'high'
        });
        const extract = (entry, binding) => api.createSymbolAuditExtraction(entry, {}, [binding]);
        const first = source('book1/01-general.md', 'L is a chosen bound for F on X. SOURCE_CONTEXT_GENERAL');
        const second = source('book1/02-special.md', 'K is the same chosen bound restricted to A. SOURCE_CONTEXT_SPECIAL');
        first.registeredSymbols.push({ pattern: 'L', display: 'L', meaning: 'MAINTAINED_BOUND_CONVENTION', scope: 'book', sourceLine: 3 });
        const extractions = [extract(first, raw('L', 'chosen-bound', '映射 F 的所选上界')), extract(second, raw('K', 'chosen-bound', '映射 F 的所选上界'))];
        const bindings = extractions.flatMap(entry => entry.bindings);
        const candidates = api.analyzeSymbolAuditBindings(bindings).candidates;
        assert.equal(candidates.length, 1, 'Matching key and meaning hints must not duplicate a candidate.');
        assert.equal(candidates[0].kind, 'notation-choice');
        assert.deepEqual(api.analyzeSymbolAuditBindings([...bindings].reverse()).candidates, candidates, 'Evidence identity is independent of input order.');
        const assessment = (candidate, relation, overrides = {}) => ({
            candidateId: candidate.id, expression: candidate.expression, relation,
            confidence: 'high', readerRisk: relation === 'notation-reuse', reason: '以限制记号复用同一上界，可减少独立约定。',
            bindingKeys: candidate.bindings.map(binding => binding.bindingKey), bindingIds: candidate.bindings.map(binding => binding.id), ...overrides
        });
        const reuse = api.createSymbolAuditReport(extractions, {}, 2, 0, [assessment(candidates[0], 'notation-reuse')]);
        assert.equal(reuse.hardConflicts.length, 0);
        assert.equal(reuse.advisories.length, 1);
        assert.equal(reuse.advisories[0].severity, 'notice');
        assert.equal(reuse.advisories[0].candidateId, candidates[0].id);
        const renamed = extract(second, raw('M', 'different-model-key', bindings[0].meaning));
        assert.equal(api.analyzeSymbolAuditBindings([...extractions[0].bindings, ...renamed.bindings]).candidates[0].kind, 'notation-choice', 'Matching meanings can nominate candidates despite different keys and letters.');
        const unrelated = extract(second, raw('n', 'local-index', '求和指标', 'n', 'temporary'));
        assert.equal(api.analyzeSymbolAuditBindings([...extractions[0].bindings, ...unrelated.bindings]).candidates.length, 0);
        for (const invalid of [
            assessment(candidates[0], 'conflict'),
            assessment(candidates[0], 'notation-reuse', { confidence: 'low' }),
            assessment(candidates[0], 'notation-reuse', { bindingIds: [bindings[0].id] }),
            assessment(candidates[0], 'notation-reuse', { bindingIds: ['invented-evidence'] }),
            assessment(candidates[0], 'notation-reuse', { candidateId: 'unknown-candidate' })
        ]) {
            const report = api.createSymbolAuditReport(extractions, {}, 0, 2, [invalid]);
            assert.equal(report.hardConflicts.length, 0);
            assert.equal(report.reconciliations[0].relation, 'uncertain', 'Invalid or incomplete evidence cannot become a reuse finding.');
        }

        const certificate = extract(first, raw('c', 'certificate-cost', '所选证书的代价', 'c'));
        const optimum = extract(second, raw('c^{*}', 'optimal-value', '所有证书上的最优值', 'c'));
        const distinction = api.analyzeSymbolAuditBindings([...certificate.bindings, ...optimum.bindings]).candidates[0];
        assert.equal(distinction.kind, 'notation-choice', 'A common base nominates a review, not an equivalence.');
        const retained = api.createSymbolAuditReport([certificate, optimum], {}, 0, 2, [assessment(distinction, 'distinct-bindings', { reason: '证书代价与最优值需要同时区分。' })]);
        assert.equal(retained.hardConflicts.length + retained.advisories.length, 0);
        assert.equal(retained.reconciliations[0].relation, 'distinct-bindings');

        const locals = [extract(first, raw('r', 'local-radius', '本证明的半径', 'r', 'temporary')), extract(second, raw('r', 'local-index', '另一证明的指标', 'r', 'temporary'))];
        const localCandidate = api.analyzeSymbolAuditBindings(locals.flatMap(entry => entry.bindings)).candidates[0];
        const compatible = api.createSymbolAuditReport(locals, {}, 0, 2, [assessment(localCandidate, 'compatible-reuse', { readerRisk: false })]);
        assert.equal(compatible.hardConflicts.length + compatible.advisories.length, 0);
        const collisions = [extract(first, raw('C', 'declared-operator', '全书算子')), extract(second, raw('C', 'overlapping-bound', '重叠范围内的上界'))];
        const collision = api.analyzeSymbolAuditBindings(collisions.flatMap(entry => entry.bindings)).candidates[0];
        const hard = api.createSymbolAuditReport(collisions, {}, 0, 2, [assessment(collision, 'conflict')]);
        assert.equal(hard.hardConflicts.length, 1, 'The existing same-surface conflict path remains available.');
        const sharedKey = extract(second, raw('C', 'declared-operator', '不同数学角色的上界'));
        assert.equal(api.analyzeSymbolAuditBindings([...collisions[0].bindings, ...sharedKey.bindings]).candidates.length, 1, 'A shared model key cannot hide different meaning evidence.');
        assert.equal(api.createSymbolAuditReport(extractions, {}, 0, 2, [], collisions.flatMap(entry => entry.bindings)).candidates.length, 1, 'Out-of-scope-only collisions do not become findings.');

        const runner = new api.CodexSymbolAuditRunner();
        let prompt, schema;
        runner.startEphemeralTurn = async (_root, suppliedPrompt, _settings, suppliedSchema) => {
            prompt = suppliedPrompt; schema = suppliedSchema;
            return { text: JSON.stringify({ reconciliations: [assessment(candidates[0], 'notation-reuse')] }) };
        };
        await runner.reconcileCandidates(temporary, candidates, {}, undefined, [first, second]);
        const payload = JSON.parse(prompt.split('Candidate groups:\n\n')[1]);
        assert.equal(payload[0].candidateId, candidates[0].id);
        assert.deepEqual(payload[0].bindings.map(binding => binding.id).sort(), bindings.map(binding => binding.id).sort());
        assert.ok(payload[0].bindings.some(binding => binding.sourceContext.markdown.includes('SOURCE_CONTEXT_GENERAL')));
        assert.ok(payload[0].bindings.some(binding => binding.sourceContext.markdown.includes('SOURCE_CONTEXT_SPECIAL')));
        assert.equal(payload[0].maintainedNotation[0].meaning, 'MAINTAINED_BOUND_CONVENTION');
        assert.ok(schema.properties.reconciliations.items.required.includes('bindingIds'));

        const project = path.join(temporary, 'project');
        await fs.mkdir(path.join(project, '.math-workspace'), { recursive: true });
        await fs.mkdir(path.join(project, 'book1'));
        await fs.writeFile(path.join(project, '.math-workspace/config.json'), '{}\n');
        for (const entry of [first, second]) await fs.writeFile(path.join(project, entry.filePath), entry.content);
        const storePath = path.join(temporary, 'audit-state.json');
        const store = new api.SymbolAuditStore({ stateFilePath: storePath });
        for (const entry of extractions) await store.saveExtraction(project, entry);
        await store.saveReport(project, { ...reuse, cacheKey: 'prior-review-version', reviewVersion: 'symbol-audit-reconciliation-v1' });
        const snapshot = { documents: new Map([first, second].map(entry => [entry.filePath, entry.content])), state: { pages: [first, second].map(entry => ({ filePath: entry.filePath, title: entry.filePath })), symbols: [] } };
        const stale = await api.readSymbolAuditStatus(project, snapshot, store);
        assert.equal(stale.reportState, 'stale');
        assert.equal(stale.cache.reusableFiles, 2, 'A review upgrade preserves per-file extraction caches.');
        let reviewCalls = 0;
        const fakeRunner = {
            extract: async () => { throw new Error('Unchanged extraction must be reused.'); },
            reconcileCandidates: async (_root, groups, _settings, _activity, sources) => {
                reviewCalls++; assert.equal(sources.length, 2);
                return { reconciliations: groups.map(group => assessment(group, 'notation-reuse')) };
            }, close: async () => {}
        };
        const service = new api.SymbolAuditService({ store, runner: fakeRunner });
        const finish = async () => {
            for (let attempt = 0; attempt < 100; attempt++) {
                const status = await service.status(project, snapshot);
                if (status.job?.status === 'failed') throw new Error(status.job.error);
                if (status.job?.status === 'complete') return status;
                await new Promise(resolve => setTimeout(resolve, 5));
            }
            throw new Error('Symbol audit did not complete.');
        };
        await service.start(project, snapshot);
        const current = await finish();
        assert.equal(current.reportState, 'current');
        assert.equal(current.job.reusedFiles, 2); assert.equal(current.job.modelCalls, 1);
        await service.start(project, snapshot); await finish();
        assert.equal(reviewCalls, 1, 'Reading or rerunning an unchanged cached report does not invoke the model.');
        const queries = new api.WorkspaceQueries({ rootPath: project, symbolAuditStatePath: storePath });
        const projected = await queries.symbolAuditReport();
        assert.equal(projected.report.findings[0].kind, 'notation-choice');
        assert.deepEqual(projected.report.findings[0].bindings.map(binding => binding.expression).sort(), ['K', 'L']);
        await service.close();
        const identitySources = ['alpha-a', 'alpha-b', 'beta-a', 'beta-b'].map((name, index) => source(`book1/${index + 3}-${name}.md`, `In this proof, ${index % 2 ? 'B' : 'A'} denotes the ${name.split('-')[0]} quantity.`));
        const identityExtractions = identitySources.map((entry, index) => extract(entry, raw(index % 2 ? 'B' : 'A', index < 2 ? 'alpha-quantity' : 'beta-quantity', index < 2 ? '第一证明的量' : '第二证明的量', index % 2 ? 'B' : 'A', 'temporary')));
        const identityCandidates = api.analyzeSymbolAuditBindings(identityExtractions.flatMap(entry => entry.bindings)).candidates;
        const choices = identityCandidates.filter(candidate => candidate.kind === 'notation-choice');
        assert.equal(choices.length, 2); assert.equal(choices[0].expression, choices[1].expression);
        assert.notEqual(choices[0].id, choices[1].id, 'Equal display headings retain separate evidence identities.');
        const identityReport = api.createSymbolAuditReport(identityExtractions, {}, 4, 0, identityCandidates.map(candidate => assessment(candidate,
            candidate.kind === 'collision' ? 'compatible-reuse' : 'notation-reuse',
            { readerRisk: false, reason: candidate.bindings.some(binding => binding.bindingKey === 'alpha-quantity') && candidate.kind === 'notation-choice' ? 'PROOF_ALPHA' : 'PROOF_BETA' })));
        for (const [index, entry] of identitySources.entries()) {
            await fs.writeFile(path.join(project, entry.filePath), entry.content);
            await store.saveExtraction(project, identityExtractions[index]);
        }
        await store.saveReport(project, identityReport);
        const identityProjection = await queries.symbolAuditReport();
        const alphaFinding = identityProjection.report.findings.find(finding => finding.reason === 'PROOF_ALPHA');
        assert.deepEqual(alphaFinding.bindings.map(binding => binding.filePath).sort(), identitySources.slice(0, 2).map(entry => entry.filePath));
        await reportUi(reuse, retained, identityReport);
        console.log('Symbol audit: cross-notation candidates, source evidence, retained distinctions, conservative normalization, scope filtering, cache upgrade, passive MCP projection and bilingual report passed.');
    } finally { await fs.rm(temporary, { recursive: true, force: true }); }
}

async function reportUi(reuse, retained, identityReport) {
    const h = await readerToolbarHarness();
    try {
        const ts = require('typescript'), exports = {};
        const modules = {
            './reader-ui-labels': {
                readerLabel: element => element,
                readerText: (element, value) => { element.textContent = value(); return element; },
                readerAttribute: (element, name, value) => element.setAttribute(name, value())
            },
            './formal-renderer': { renderReaderFormula: ({ latex }) => latex },
            './reader-icons': { readerIcon: () => h.document.createElement('svg') }
        };
        const source = await fs.readFile(path.join(root, 'src/reader/web/reader-symbol-audit-report.ts'), 'utf8');
        vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText,
            { exports, require: name => modules[name], document: h.document });
        const view = new exports.ReaderSymbolAuditReportView();
        const located = [];
        const host = { language: 'zh', sourceTitle: filePath => filePath, locate: (...args) => located.push(args), close() {} };
        const status = report => ({ report, reportState: 'current', scope: { selectedFilePaths: ['a', 'b'] } });
        const container = h.document.createElement('div');
        view.render(container, status(reuse), host);
        assert.ok(container.textContent.includes('复用建议'));
        const locations = container.querySelectorAll('.reader-symbol-audit-report-source');
        assert.equal(locations.length, 2);
        h.click(locations[0]); assert.equal(located[0][1], 3);
        view.render(container, status(retained), host);
        assert.ok(container.textContent.includes('保留区分'));
        view.render(container, status(reuse), { ...host, language: 'en' });
        assert.ok(container.textContent.includes('Reuse suggestion'));
        view.render(container, status(retained), { ...host, language: 'en' });
        assert.ok(container.textContent.includes('Retain distinction'));
        view.render(container, status(identityReport), host);
        const alpha = container.querySelectorAll('.reader-symbol-audit-report-entry').find(entry => entry.classList.contains('is-notice') && entry.textContent.includes('PROOF_ALPHA'));
        const sourceButtons = alpha.querySelectorAll('.reader-symbol-audit-report-source');
        assert.equal(sourceButtons.length, 2);
        assert.ok(sourceButtons.every(button => button.textContent.includes('alpha')), 'Reader source links follow candidate IDs rather than ambiguous display headings.');
    } finally { h.restore(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await testSymbolAuditNotation();
