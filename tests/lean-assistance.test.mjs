import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createLeanReviewFixture } from './lean-review.test.mjs';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const A = 'h-1111111111111111';
const exists = file => fs.access(file).then(() => true, () => false);
const suggestion = keys => ({ category: 'assumption', title: 'Construction may be an input assumption', note: 'The prose asks for construction, while certificate_input consumes certificate. Check this scope difference.', declarationKeys: keys });

export async function testLeanAssistance() {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'math-workspace-assistance-'));
    let review, reader, client, mcp;
    try {
        const entries = ['src/lean/lean-review-service.ts', 'src/lean/lean-assistance-service.ts', 'src/lean/lean-assistance-routes.ts', 'src/lean/lean-audit-store.ts', 'src/mcp/lean-assistance-tools.ts', 'src/reader/server.ts'];
        await build({ entryPoints: entries.map(file => path.join(repoRoot, file)), bundle: true, platform: 'node', format: 'cjs', outdir: path.join(temporary, 'bundle'),
            outExtension: { '.js': '.cjs' }, tsconfig: path.join(repoRoot, 'tsconfig.cli.json'), logLevel: 'silent' });
        const { LeanReviewService } = require(path.join(temporary, 'bundle/lean/lean-review-service.cjs'));
        const { LeanAssistanceService } = require(path.join(temporary, 'bundle/lean/lean-assistance-service.cjs'));
        const { handleLeanAssistanceRoute } = require(path.join(temporary, 'bundle/lean/lean-assistance-routes.cjs'));
        const { updateAuditRecord } = require(path.join(temporary, 'bundle/lean/lean-audit-store.cjs'));
        const { registerLeanAssistanceTools } = require(path.join(temporary, 'bundle/mcp/lean-assistance-tools.cjs'));
        const { startReaderServer } = require(path.join(temporary, 'bundle/reader/server.cjs'));
        const root = await fs.realpath(await createLeanReviewFixture(path.join(temporary, 'project'), { buildLean: false }));
        const foreign = await createLeanReviewFixture(path.join(temporary, 'foreign'), { buildLean: false });
        const leanFile = path.join(root, 'lean/ReviewFixture.lean'), proseFile = path.join(root, 'book/01-review.md');
        const leanBefore = await fs.readFile(leanFile, 'utf8'), proseBefore = await fs.readFile(proseFile, 'utf8');
        review = new LeanReviewService(); const service = new LeanAssistanceService(review);
        let context = await service.get(root, A, 'assumptions');
        assert.equal(context.projectRoot, await fs.realpath(root));
        assert.equal(context.evidenceState, 'unavailable');
        assert.ok(context.materials.some(item => item.filePath === 'book/01-review.md' && item.fingerprint && item.startLine > 0));
        assert.match(context.boundary, /Unsaved Reader drafts are not included/);
        assert.equal(await exists(path.join(root, '.math-workspace/lean-assistance')), false, 'Reading context must not create metadata.');
        const keys = (await review.get(root, A)).evidence.declarations.map(item => item.key), item = suggestion(keys);
        const input = () => ({ binding: context.binding, task: context.task, items: [item] });
        await assert.rejects(service.submit(foreign, input()), /another project/);
        await assert.rejects(service.submit(root, { ...input(), binding: { ...context.binding, id: 'h-2222222222222222' } }), /Source, project, object/);
        await assert.rejects(service.submit(root, { ...input(), items: [{ ...item, verdict: 'aligned' }] }), /no verdict/);
        await assert.rejects(service.submit(root, { ...input(), items: [{ ...item, declarationKeys: ['other:wrong'] }] }), /must belong/);
        assert.equal(await exists(path.join(root, '.math-workspace/lean-assistance/' + A + '.json')), false);
        const first = await service.submit(root, input());
        assert.equal(first.candidates.length, 1); assert.equal(first.binding.candidateRevision, 1);
        await assert.rejects(service.submit(root, input()), /another window/);
        assert.equal(await exists(path.join(root, '.math-workspace/lean-reviews')), false);
        assert.equal(await exists(path.join(root, '.math-workspace/lean-audits')), false);
        context = first;
        await fs.writeFile(proseFile, proseBefore.replace('The claim is global in n.', 'The claim now has a different scope.'));
        await assert.rejects(service.submit(root, input()), /Source, project, object/);
        assert.equal((await service.get(root, A)).candidates[0].freshness, 'stale');
        await fs.writeFile(proseFile, proseBefore); context = await service.get(root, A);
        const response = await review.get(root, A);
        await review.action(root, { action: 'save', id: A, expectedRevision: 0, evidenceFingerprint: response.evidence.fingerprint,
            verdict: 'undecided', scope: 'Construction requires human inspection.', note: '', reviewer: 'Author', subclaims: [] });
        await assert.rejects(service.submit(root, input()), /human review or audit changed/);
        context = await service.get(root, A);
        await updateAuditRecord(root, A, 0, async () => {});
        await assert.rejects(service.submit(root, input()), /human review or audit changed/);
        context = await service.get(root, A);
        const humanBytes = await fs.readFile(path.join(root, '.math-workspace/lean-reviews/' + A + '.json'), 'utf8');
        const auditBytes = await fs.readFile(path.join(root, '.math-workspace/lean-audits/' + A + '.json'), 'utf8');
        const competing = await Promise.allSettled([service.submit(root, input()), service.submit(root, input())]);
        assert.equal(competing.filter(value => value.status === 'fulfilled').length, 1, 'The candidate write lock admits exactly one peer.');
        const latest = await service.get(root, A);
        await service.dismiss(root, { binding: latest.binding, candidateId: latest.candidates.at(-1).candidate.id });
        await assert.rejects(service.dismiss(root, { binding: latest.binding, candidateId: latest.candidates.at(-1).candidate.id }), /another window/);
        assert.equal(await fs.readFile(path.join(root, '.math-workspace/lean-reviews/' + A + '.json'), 'utf8'), humanBytes);
        assert.equal(await fs.readFile(path.join(root, '.math-workspace/lean-audits/' + A + '.json'), 'utf8'), auditBytes);
        await assert.rejects(handleLeanAssistanceRoute(service, root, 'POST', '/api/lean-assistance/action', new URLSearchParams(), { action: 'submit', ...input() }), /route not found/);

        // A real MCP protocol client with a fake model response; no native conversation/model turn.
        mcp = new McpServer({ name: 'assistance-fixture', version: '1.0.0' });
        registerLeanAssistanceTools(mcp, service);
        client = new Client({ name: 'candidate-fixture-client', version: '1.0.0' });
        const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
        await mcp.connect(serverTransport); await client.connect(clientTransport);
        const tools = (await client.listTools()).tools;
        assert.equal(tools.find(tool => tool.name === 'read_lean_review_context').annotations.readOnlyHint, true);
        assert.equal(tools.find(tool => tool.name === 'submit_lean_review_candidates').annotations.readOnlyHint, false);
        assert.ok(tools.find(tool => tool.name === 'read_lean_review_context').inputSchema.required.includes('projectRoot'));
        const call = (name, args) => client.callTool({ name, arguments: args });
        const loaded = await call('read_lean_review_context', { projectRoot: root, projectToken: context.binding.projectToken, id: A, task: 'proof' });
        assert.equal(loaded.isError, undefined); const mcpContext = loaded.structuredContent.result;
        assert.equal(mcpContext.projectRoot, await fs.realpath(root));
        const foreignRead = await call('read_lean_review_context', { projectRoot: foreign, projectToken: mcpContext.binding.projectToken, id: A });
        assert.equal(foreignRead.isError, true);
        const invalid = await call('submit_lean_review_candidates', { projectRoot: root, binding: mcpContext.binding, task: 'proof', items: [{ ...item, verdict: 'aligned' }] });
        assert.equal(invalid.isError, true, 'MCP schema rejects a model verdict.');
        const extra = await call('submit_lean_review_candidates', { projectRoot: root, binding: mcpContext.binding, task: 'proof', items: [item], verdict: 'aligned' });
        assert.equal(extra.isError, true, 'The outer MCP schema is strict too.');
        const submitted = await call('submit_lean_review_candidates', { projectRoot: root, binding: mcpContext.binding, task: 'proof', items: [item] });
        assert.equal(submitted.isError, undefined);
        const current = submitted.structuredContent.result;
        assert.equal(current.binding.candidateRevision, mcpContext.binding.candidateRevision + 1);
        const routeResult = await handleLeanAssistanceRoute(service, root, 'GET', '/api/lean-assistance', new URLSearchParams({ id: A }));
        assert.equal(routeResult.value.candidates.at(-1).candidate.title, item.title, 'MCP result is immediately visible through the Reader route.');

        reader = await startReaderServer({ rootPath: root, port: 0, recentProjectsPath: path.join(temporary, 'recent.json'), locationRegistryPath: path.join(temporary, 'locations.json') });
        const state = await (await fetch(reader.url + '/api/state')).json();
        const headers = { 'content-type': 'application/json', 'x-math-workspace-token': state.requestToken, 'x-math-workspace-project': state.projectId };
        assert.equal((await fetch(reader.url + '/api/lean-assistance?id=' + A)).status, 403);
        assert.equal((await fetch(reader.url + '/api/lean-assistance?id=' + A, { headers: { ...headers, 'x-math-workspace-project': 'foreign' } })).status, 409);
        const visible = await (await fetch(reader.url + '/api/lean-assistance?id=' + A, { headers })).json();
        assert.equal(visible.binding.candidateRevision, current.binding.candidateRevision);
        assert.equal(visible.candidates.at(-1).candidate.title, item.title);
        const body = JSON.stringify({ action: 'dismiss', binding: visible.binding, candidateId: visible.candidates.at(-1).candidate.id });
        assert.equal((await fetch(reader.url + '/api/lean-assistance/action', { method: 'POST', headers: { ...headers, origin: 'https://foreign.invalid' }, body })).status, 403);
        assert.equal((await fetch(reader.url + '/api/lean-assistance/action', { method: 'POST', headers, body })).status, 200);
        assert.equal(await fs.readFile(leanFile, 'utf8'), leanBefore);
        assert.equal(await fs.readFile(proseFile, 'utf8'), proseBefore);
        assert.equal(await fs.readFile(path.join(root, '.math-workspace/lean-reviews/' + A + '.json'), 'utf8'), humanBytes);
        assert.equal(await fs.readFile(path.join(root, '.math-workspace/lean-audits/' + A + '.json'), 'utf8'), auditBytes);

        const candidateFile = path.join(root, '.math-workspace/lean-assistance/' + A + '.json');
        const savedBytes = await fs.readFile(candidateFile, 'utf8');
        await fs.writeFile(candidateFile, '{');
        await assert.rejects(service.get(root, A), /malformed/);
        assert.equal(await fs.readFile(candidateFile, 'utf8'), '{');
        await fs.writeFile(candidateFile, savedBytes);
        await fs.rename(candidateFile, candidateFile + '.preserved');
        await fs.symlink(proseFile, candidateFile);
        await assert.rejects(service.get(root, A), /bounded regular file/);
        assert.equal(await fs.readFile(proseFile, 'utf8'), proseBefore, 'A malicious candidate symlink cannot redirect writes to source.');
        await fs.rm(candidateFile); await fs.rename(candidateFile + '.preserved', candidateFile);
        // Bounded material output discloses both partial strings and omitted entries.
        const fake = structuredClone(await review.get(root, A));
        fake.evidence.contexts = Array.from({ length: 40 }, () => ({ ...fake.evidence.statement, content: 'x'.repeat(10000) }));
        const bounded = await new LeanAssistanceService({ get: async () => fake }).get(root, A);
        assert.ok(bounded.materials.some(item => item.truncated)); assert.ok(bounded.omittedMaterials > 0);
        assert.ok(bounded.materials.reduce((total, item) => total + item.text.length, 0) <= 48000);
        fake.evidence.definitions = [{ ...fake.evidence.declarations[0], key: 'fixture:expanded_definition' }];
        const definitionContext = new LeanAssistanceService({ get: async () => fake });
        const withDefinition = await definitionContext.get(root, A);
        await assert.rejects(definitionContext.submit(root, { binding: withDefinition.binding, task: 'assumptions',
            items: [{ ...item, declarationKeys: ['fixture:expanded_definition'] }] }), /expanded definitions are context only/);

        console.log('ok - Lean assistance candidate isolation, CAS, MCP protocol, Reader guards, and bounded context');
    } finally { await client?.close(); await mcp?.close(); await reader?.close(); await review?.close(); await fs.rm(temporary, { recursive: true, force: true }); }
}

class AssistanceElement {
    constructor(tag, ownerDocument) { this.tagName = tag.toUpperCase(); this.ownerDocument = ownerDocument; this.children = []; this.dataset = {}; this.listeners = new Map(); this.attributes = new Map(); this._text = ''; this.className = '';
        this.classList = { add: (...names) => { this.className = [this.className, ...names].filter(Boolean).join(' '); } }; }
    get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
    set textContent(value) { this.replaceChildren(); this._text = String(value); }
    append(...children) { for (const child of children) { child.remove?.(); child.parent = this; this.children.push(child); } }
    appendChild(child) { this.append(child); return child; }
    replaceChildren(...children) { for (const child of this.children) child.parent = undefined; this.children = []; this._text = ''; this.append(...children); }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.parent = undefined; }
    setAttribute(name, value) { this.attributes.set(name, value); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    addEventListener(name, callback) { this.listeners.set(name, [...(this.listeners.get(name) || []), callback]); }
    click() { if (!this.disabled) for (const callback of this.listeners.get('click') || []) callback({ target: this }); }
    find(action) { if (this.dataset.leanAssistanceAction === action) return this; for (const child of this.children) { const found = child.find(action); if (found) return found; } }
}
const settleAssistance = async () => { for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve)); };
function uiContext(id = A) {
    const binding = { id, projectToken: 'a'.repeat(64), evidenceFingerprint: 'f'.repeat(64), reviewRevision: 0, auditRevision: 0, candidateRevision: 1 };
    return { projectRoot: '/exact/project/root', binding, task: 'statement', formal: { id, title: 'Scope' }, evidenceState: 'unavailable',
        materials: [{ kind: 'statement', label: 'book/01.md:1', text: 'Construct a certificate.', filePath: 'book/01.md', startLine: 1, fingerprint: 'f'.repeat(64) }], omittedMaterials: 0, dropped: 0,
        boundary: 'Unsaved Reader drafts are not included. AI candidates are not human decisions.',
        candidates: [{ freshness: 'current', candidate: { ...suggestion(['fixture:certificate_input']), id: 'candidate-1', task: 'statement', binding: { ...binding, candidateRevision: 0 }, createdAt: '2026-10-13T00:00:00Z', status: 'pending' } }] };
}
async function assistanceHarness() {
    const { default: vm } = await import('node:vm');
    const bundle = await build({ entryPoints: [path.join(repoRoot, 'src/reader/web/reader-lean-assistance.ts')], bundle: true, platform: 'browser', format: 'cjs',
        write: false, loader: { '.css': 'empty' }, logLevel: 'silent' });
    const document = { createElement(tag) { return new AssistanceElement(tag, this); }, createElementNS(_namespace, tag) { return this.createElement(tag); } }; document.body = document.createElement('body');
    const context = { projectId: 'a'.repeat(64), language: 'zh', requestToken: 'token', revision: 0, pagePath: 'book/01.md' };
    const module = { exports: {} }, copies = [], adopted = [], sent = [], reports = [], requests = [], draft = new Set();
    vm.runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, document, navigator: { clipboard: { writeText: async text => copies.push(text) } }, console });
    const { ReaderLeanAssistance, leanAssistanceHandoff } = module.exports;
    let current = uiContext(), override, allowAssist = true;
    const panel = new ReaderLeanAssistance({ context: () => context, request: async (route, init) => {
        requests.push({ route, init }); if (override) { const pending = override(route, init); if (pending) return pending; }
        assert.equal(init.headers['x-math-workspace-project'], context.projectId);
        assert.equal(init.headers['x-math-workspace-token'], 'token');
        if (init.method === 'POST') { const body = JSON.parse(init.body); assert.equal(body.action, 'dismiss'); current.binding.candidateRevision++; current.candidates.find(item => item.candidate.id === body.candidateId).candidate.status = 'ignored'; }
        const payload = structuredClone(current); payload.task = new URL(route, 'http://local').searchParams.get('task') || 'statement';
        return new Response(JSON.stringify(payload));
    }, canAssist: () => allowAssist, assist: async content => sent.push(content), report: (text, warning) => reports.push({ text, warning }),
    adoptCandidate: (item, binding) => { adopted.push({ item, binding }); draft.add(item.id); return true; }, candidateInDraft: id => draft.has(id) });
    const region = panel.mount(); document.body.append(region);
    const review = () => ({ id: current.binding.id, projectToken: current.binding.projectToken, evidence: { fingerprint: current.binding.evidenceFingerprint }, review: { expectedRevision: current.binding.reviewRevision } });
    const find = action => { const node = region.find(action); assert.ok(node, action); return node; };
    return { panel, region, context, copies, adopted, sent, reports, requests, review, find, draft, leanAssistanceHandoff,
        get current() { return current; }, set current(value) { current = value; }, setOverride: value => override = value, setAssist: value => allowAssist = value };
}

export async function testReaderLeanAssistance() {
    const h = await assistanceHarness(); h.panel.update(h.review()); await settleAssistance();
    assert.match(h.region.textContent, /Construction may/);
    const iconAction = (name, expected) => { const button = h.find(name), description = button.getAttribute('aria-label'); assert.equal(button.textContent, '');
        assert.equal(button.children.length, 1); assert.equal(button.children[0].tagName, 'SVG'); assert.match(description, expected);
        assert.equal(button.getAttribute('title'), description); assert.equal(button.dataset.readerTooltip, description); return button; };
    const glyph = name => h.find(name).children[0].children.map(node => [node.tagName, [...node.attributes]]);
    assert.equal(new Set(['assumptions', 'statement', 'proof', 'changes'].map(name => JSON.stringify(glyph(name)))).size, 4, 'Each review task has a distinct glyph.');
    iconAction('assumptions', /发送后开始核对/); iconAction('adopt', /加入未决定草稿/);
    h.find('assumptions').click(); await settleAssistance();
    assert.equal(h.sent.length, 1); const handoff = h.sent[0][0].resource.text;
    assert.match(handoff, /read_lean_review_context/); assert.match(handoff, /submit_lean_review_candidates/);
    assert.match(handoff, /\/exact\/project\/root/); assert.doesNotMatch(handoff, /Construct a certificate\./); assert.ok(handoff.length < 5000, 'Composer handoff remains concise; the read tool owns source material.'); assert.match(handoff, /Unsaved Reader drafts/); assert.match(handoff, /"task": "assumptions"/);
    assert.match(h.reports.at(-1).text, /尚未发送/);
    assert.equal(h.requests.filter(item => item.init.method === 'POST').length, 0, 'Preparing native context never persists a human or candidate record.');
    h.find('adopt').click(); await settleAssistance(); assert.equal(h.adopted.length, 1);
    assert.equal(h.adopted[0].item.verdict, undefined, 'The AI candidate has no verdict.');
    assert.equal(h.find('adopt').disabled, true);
    iconAction('adopt', /已加入草稿.*尚未保存人工结论/);
    h.draft.delete('candidate-1'); h.panel.update(h.review());
    assert.equal(h.find('adopt').disabled, false, 'Deleting or resetting the local draft immediately re-enables adoption.');
    h.find('adopt').click(); await settleAssistance(); assert.equal(h.adopted.length, 2);
    assert.equal(h.requests.filter(item => item.init.method === 'POST').length, 0, 'Adopting a local draft never saves a record.');
    h.setAssist(false); h.panel.update(h.review()); iconAction('proof', /复制核对材料到剪贴板/);
    h.find('proof').click(); await settleAssistance(); assert.equal(h.copies.length, 1); assert.match(h.copies[0], /"task": "proof"/);
    h.find('dismiss').click(); await settleAssistance();
    assert.match(h.region.textContent, /暂无待处理候选/); assert.doesNotMatch(h.region.textContent, /审核通过|aligned|approved/);
    h.context.language = 'en'; h.panel.update(h.review()); iconAction('refresh', /Refresh candidates/); iconAction('statement', /Compare statements.*Copy review context/);

    const stale = await assistanceHarness(); stale.panel.update(stale.review()); await settleAssistance();
    for (const field of ['candidateRevision', 'auditRevision', 'reviewRevision']) {
        stale.current.binding[field]++; stale.find('adopt').click(); await settleAssistance();
        assert.equal(stale.adopted.length, 0, field + ' must fence old adoption.');
        stale.current.binding[field]--; stale.find('refresh').click(); await settleAssistance();
    }
    stale.current.binding.evidenceFingerprint = 'e'.repeat(64); stale.find('adopt').click(); await settleAssistance(); assert.equal(stale.adopted.length, 0);
    stale.current = uiContext(); stale.current.candidates[0].freshness = 'stale'; stale.panel.metadataChanged(); await settleAssistance();
    assert.equal(stale.find('adopt').disabled, true, 'Metadata-only refresh projects stale candidates without overwriting a draft.');

    const race = await assistanceHarness(); race.panel.update(race.review()); await settleAssistance();
    let resolve; const pending = new Promise(done => resolve = done); race.setOverride(() => pending);
    race.find('statement').click();
    race.current = uiContext('h-2222222222222222'); race.context.pagePath = 'book/02.md'; race.setOverride(undefined); race.panel.update(race.review()); await settleAssistance();
    resolve(new Response(JSON.stringify(uiContext()))); await settleAssistance(); assert.equal(race.sent.length, 0, 'A late response cannot send the previous object into the composer.');
    let resolveHidden; race.setOverride(() => new Promise(done => resolveHidden = done)); race.find('statement').click(); race.panel.hide();
    resolveHidden(new Response(JSON.stringify(race.current))); await settleAssistance(); assert.equal(race.sent.length, 0); assert.equal(race.region.hidden, true);
    race.panel.destroy(); h.panel.destroy(); stale.panel.destroy();
    console.log('ok - Lean assistance task handoff, candidate drafts, stale fences, and late-response isolation');
}
