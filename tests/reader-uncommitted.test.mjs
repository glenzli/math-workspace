import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { readerToolbarHarness } from './reader-toolbar-menu.test.mjs';

const require = createRequire(import.meta.url);
const root = path.resolve(new URL('..', import.meta.url).pathname);
const digest = text => createHash('sha256').update(text).digest('hex');
const plain = value => JSON.parse(JSON.stringify(value));
const drain = async () => { for (let i = 0; i < 15; i++) await new Promise(resolve => setImmediate(resolve)); };
const git = (cwd, ...args) => execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

export async function testReaderUncommitted() {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'reader-uncommitted-contracts-'));
    try {
        await build({ entryPoints: [path.join(root, 'src/reader/git-changes.ts')], outfile: path.join(temporary, 'git.cjs'), bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' });
        const { readReaderGitChanges: read } = require(path.join(temporary, 'git.cjs'));
        const repo = path.join(temporary, 'project'); await fs.mkdir(repo); git(repo, 'init', '-q');
        git(repo, 'config', 'user.name', 'Reader fixture'); git(repo, 'config', 'user.email', 'reader@example.invalid');
        const name = 'book/chapter.md'; await fs.mkdir(path.join(repo, 'book'));
        const initial = '# Page\n\nFirst original.\n\nSecond original.\n\nUnchanged separator.\n\nRemove this paragraph.\n\nLast original.\n';
        const put = async content => { await fs.writeFile(path.join(repo, name), content); return read(repo, name, content); };
        await put(initial); git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'Initial manuscript');
        assert.deepEqual((await read(repo, name, initial)).ranges, []);
        const staged = initial.replace('First original.', 'First staged.'); await put(staged); git(repo, 'add', name);
        const working = staged.replace('Second original.', 'Second working.').replace('Remove this paragraph.\n\n', '');
        const dirty = await put(working);
        assert.equal(dirty.status, 'ready'); assert.equal(dirty.baseline, 'HEAD');
        assert.ok(dirty.ranges.some(range => range.startLine <= 3 && range.endLine >= 3), 'Staged changes are compared to HEAD.');
        assert.ok(dirty.ranges.some(range => range.startLine <= 5 && range.endLine >= 5), 'Unstaged changes are included.');
        assert.ok(dirty.deletions.some(deletion => deletion.afterLine === 8 && deletion.count === 2));
        assert.equal(dirty.sourceHash, digest(working));
        assert.deepEqual((await put(initial)).ranges, [], 'Staged changes cancelled in the working tree are not falsely marked.');
        assert.equal((await read(repo, name, working)).status, 'stale', 'A stale rendered snapshot cannot receive fresh line positions.');
        const newName = 'book/new : [稿件].md', newContent = '# New\n\nNew text.\n';
        await fs.writeFile(path.join(repo, newName), newContent);
        assert.deepEqual((await read(repo, newName, newContent)).ranges, [{ startLine: 1, endLine: 3 }]);
        git(repo, 'add', newName);
        assert.equal((await read(repo, newName, newContent)).baseline, 'new-file', 'A staged addition is still uncommitted.');
        await fs.writeFile(path.join(repo, '.gitignore'), 'ignored.md\n'); await fs.writeFile(path.join(repo, 'ignored.md'), '# Ignored');
        assert.equal((await read(repo, 'ignored.md', '# Ignored')).status, 'ignored');
        assert.equal((await read(repo, '../outside.md', '# Private')).status, 'unavailable');
        const outside = path.join(temporary, 'outside.md'); await fs.writeFile(outside, '# Outside'); await fs.symlink(outside, path.join(repo, 'linked.md'));
        assert.notEqual((await read(repo, 'linked.md', '# Outside')).status, 'ready');
        const indexBefore = await fs.readFile(path.join(repo, '.git/index'));
        await put(working);
        const headBefore = git(repo, 'rev-parse', 'HEAD');
        const trap = path.join(temporary, 'filter-trap.sh'), trapReceipt = path.join(temporary, 'filter-ran');
        await fs.writeFile(trap, `#!/bin/sh\ntouch '${trapReceipt}'\ncat\n`); await fs.chmod(trap, 0o755);
        git(repo, 'config', 'filter.reader.clean', trap); git(repo, 'config', 'diff.reader.command', trap);
        await fs.writeFile(path.join(repo, '.gitattributes'), '*.md filter=reader diff=reader\n');
        await read(repo, name, working + 'stale');
        const uncached = working + '\nAnother pending paragraph.\n'; await put(uncached);
        assert.equal(await fs.access(trapReceipt).then(() => true, () => false), false, 'Reading markers does not execute project clean/diff helpers.');
        assert.deepEqual(await fs.readFile(path.join(repo, '.git/index')), indexBefore); assert.equal(git(repo, 'rev-parse', 'HEAD'), headBefore);
        await fs.rm(path.join(repo, '.gitattributes')); git(repo, 'config', '--remove-section', 'filter.reader'); git(repo, 'config', '--remove-section', 'diff.reader');
        git(repo, 'add', name); git(repo, 'commit', '-qm', 'Accept changed manuscript');
        assert.deepEqual((await read(repo, name, uncached)).ranges, [], 'A commit clears markers without changing Markdown bytes.');
        const worktree = path.join(temporary, 'worktree'); git(repo, 'worktree', 'add', '--detach', '-q', worktree);
        const worktreeContent = uncached.replace('First staged.', 'Worktree edit.'); await fs.writeFile(path.join(worktree, name), worktreeContent);
        assert.ok((await read(path.join(worktree, 'book'), 'chapter.md', worktreeContent)).ranges.length, 'Linked worktrees and nested project roots use the owning Git history.');
        const unborn = path.join(temporary, 'unborn'); await fs.mkdir(unborn); git(unborn, 'init', '-q'); await fs.writeFile(path.join(unborn, 'new.md'), newContent);
        assert.equal((await read(unborn, 'new.md', newContent)).baseline, 'new-file');
        const ordinary = path.join(temporary, 'ordinary'); await fs.mkdir(ordinary); await fs.writeFile(path.join(ordinary, 'page.md'), initial);
        assert.equal((await read(ordinary, 'page.md', initial)).status, 'not-git');
        const deleted = await put(''); assert.ok(deleted.deletions.length); assert.equal(deleted.ranges.length, 0);

        await uiContracts();
        console.log('Reader uncommitted markers: HEAD/staged/working/new files, deletion positions, worktrees, snapshot guards, no project writes, opt-in lifecycle and stale responses passed.');
    } finally { await fs.rm(temporary, { recursive: true, force: true }); }
}

async function uiContracts() {
    const h = await readerToolbarHarness({ withoutWebCrypto: true }), { app, find, click, document } = h;
    try {
        const source = '# Original\n\nA changed paragraph.\n\nAn unchanged paragraph.\n';
        const heading = document.createElement('h1'), paragraph = document.createElement('p'), unchanged = document.createElement('p');
        for (const [element, start, text] of [[heading, 1, 'Original'], [paragraph, 3, 'A changed paragraph.'], [unchanged, 5, 'An unchanged paragraph.']]) {
            element.dataset.sourceStartLine = String(start); element.dataset.sourceEndLine = String(start); element.textContent = text; app.article.append(element);
        }
        paragraph.setAttribute('data-reader-tooltip', 'Existing tooltip');
        const expected = { filePath: 'book/01.md', sourceHash: digest(source), status: 'ready', ranges: [{ startLine: 3, endLine: 3 }], deletions: [{ afterLine: 4, count: 2 }] };
        let pending;
        h.setRequestHandler(async route => route.startsWith('/api/page-changes') ? pending ? await pending : { ok: true, json: async () => plain(expected) } : Promise.reject(new Error(route)));
        const page = { filePath: 'book/01.md', sourceHash: digest(source), project: 'project-a', token: 'token-a' };
        app.uncommitted.bind(page);
        assert.equal(find('#reader-uncommitted').getAttribute('aria-checked'), 'false'); assert.equal(h.createRequests.length, 0, 'Default-off mode performs no Git request.');
        click(find('[data-tool-menu="display"]')); click(find('#reader-uncommitted')); await drain();
        assert.equal(find('#reader-category-menu').hidden, false); assert.equal(find('#reader-uncommitted').getAttribute('aria-checked'), 'true');
        assert.equal(paragraph.classList.contains('has-uncommitted-change'), true); assert.equal(heading.classList.contains('has-uncommitted-change'), false);
        assert.equal(find('#reader-uncommitted-status').textContent, '2 处', 'Embedded views work without Web Crypto and visibly report rendered markers.');
        assert.equal(app.article.querySelectorAll('.reader-change-marker').length, 2);
        assert.ok(app.article.querySelectorAll('.reader-change-marker').every(marker => marker.parentElement === app.article), 'Gutter markers remain outside scrolling source blocks.');
        assert.equal(unchanged.classList.contains('has-uncommitted-change'), false); assert.equal(unchanged.classList.contains('has-uncommitted-deletion'), true);
        assert.equal(paragraph.textContent, 'A changed paragraph.'); assert.match(paragraph.dataset.readerTooltip, /3/);
        const requests = h.createRequests.length; h.preferences.setLanguage('en'); app.uncommitted.updateLanguage();
        assert.match(paragraph.dataset.readerTooltip, /Uncommitted/); assert.equal(h.createRequests.length, requests, 'Relabeling does not repeat the Git request.');
        click(find('#reader-uncommitted')); assert.equal(paragraph.classList.contains('has-uncommitted-change'), false);
        assert.equal(paragraph.dataset.readerTooltip, 'Existing tooltip'); assert.equal(unchanged.classList.contains('has-uncommitted-deletion'), false);
        assert.equal(find('#reader-uncommitted-status').hidden, true);
        assert.equal(app.article.querySelectorAll('.reader-change-marker').length, 0);
        let finish; pending = new Promise(resolve => { finish = resolve; });
        click(find('#reader-uncommitted')); await drain();
        app.uncommitted.bind(); finish({ ok: true, json: async () => expected }); await drain();
        assert.equal(paragraph.classList.contains('has-uncommitted-change'), false, 'An old page response cannot mark the next page.');
        pending = undefined; expected.sourceHash = digest('Other version'); app.uncommitted.bind(page); await drain();
        assert.equal(paragraph.classList.contains('has-uncommitted-change'), false, 'Wrong snapshot hashes cannot be projected onto current prose.');
        expected.sourceHash = digest(source); app.uncommitted.bind(page); await drain();
        assert.equal(paragraph.classList.contains('has-uncommitted-change'), true);
        expected.ranges = []; expected.deletions = []; h.flushTimers(); await drain();
        assert.equal(paragraph.classList.contains('has-uncommitted-change'), false, 'Polling clears markers when Git HEAD catches up.');
        assert.equal(find('#reader-uncommitted-status').textContent, 'No changes');
        h.setRequestHandler(async () => ({ ok: false, status: 404 })); h.flushTimers(); await drain();
        assert.equal(find('#reader-uncommitted-status').textContent, 'Restart Reader', 'Old running services cannot silently leave the toggle looking enabled.');
        assert.match(find('#reader-uncommitted').dataset.readerTooltip, /restart the client/);
        h.setRequestHandler(async () => { throw new Error('Host transport unavailable'); }); h.flushTimers(); await drain();
        assert.equal(find('#reader-uncommitted-status').textContent, 'Read failed');
        h.setRequestHandler(async () => ({ ok: true, json: async () => ({ ...expected, status: 'not-git' }) })); h.flushTimers(); await drain();
        assert.equal(find('#reader-uncommitted-status').textContent, 'No Git repository');
    } finally { app.uncommitted.dispose(); h.restore(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) await testReaderUncommitted();
