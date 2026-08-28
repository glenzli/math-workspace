#!/usr/bin/env node

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const OFFICIAL_NPM_REGISTRY = 'https://registry.npmjs.org';
const RELEASE_NPM_CACHE = process.env.MATH_WORKSPACE_NPM_CACHE || '/private/tmp/math-workspace-npm-cache';
const targetsAll = ['github', 'gitlab', 'npm'];

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function usage() {
    return [
        'Usage:',
        '  npm run release -- [options]',
        '  npm run release:preflight',
        '',
        'Targets:',
        '  github    Push branch/tag to GitHub and create a GitHub release.',
        '  gitlab    Push branch/tag to GitLab and create a GitLab release.',
        '  npm       Publish the npm package after Git and marketplace publication.',
        '',
        'Options:',
        '  --only <targets>          Comma-separated target list, e.g. github,npm.',
        '  --skip <targets>          Comma-separated target list to exclude.',
        '  --dry-run                 Inspect local inputs and print mutations.',
        '  --preflight               Run all non-mutating remote/auth checks, then stop.',
        '  --no-check                Skip npm run release:check.',
        '  --tag <tag>               Release tag. Defaults to v<package.version>.',
        '  --npm-tag <tag>           npm dist-tag. Defaults to latest.',
        '  --otp <code>              npm one-time password.',
        '  --github-remote <name>    GitHub git remote. Defaults to github.',
        '  --gitlab-remote <name>    GitLab git remote. Defaults to gitlab.',
        '  --github-repo <repo>      gh repo selector. Defaults to glenzli/math-workspace.',
        '  --gitlab-repo <repo>      glab repo selector. Defaults to glenzli/math-workspace.',
        '  --marketplace-root <dir>  Public marketplace checkout. Defaults to ../marketplace.',
        '  --marketplace-remote <n>  Marketplace git remote. Defaults to origin.',
        '  --marketplace-branch <n>  Marketplace branch. Defaults to main.',
        '  --skip-marketplace        Do not verify or publish the marketplace snapshot.',
        '  --draft                   Create a draft GitHub release.',
        '  --prerelease              Mark the GitHub release as prerelease.',
        '',
        'Normal release order:',
        '  marketplace branch -> source branches/tags -> GitHub/GitLab releases -> npm',
        '',
        'Examples:',
        '  npm run release -- --dry-run',
        '  npm run release:preflight',
        '  npm run release -- --only github,npm',
        '  npm run release -- --skip gitlab',
    ].join('\n');
}

function parseList(value) {
    return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function normalizeTarget(target) {
    if (target === 'npmjs') return 'npm';
    if (target === 'all') return 'all';
    return target;
}

function parseArgs(argv) {
    const options = {
        dryRun: false,
        preflightOnly: false,
        check: true,
        only: [],
        skip: [],
        tag: undefined,
        npmTag: 'latest',
        otp: undefined,
        githubRemote: 'github',
        gitlabRemote: 'gitlab',
        githubRepo: 'glenzli/math-workspace',
        gitlabRepo: 'glenzli/math-workspace',
        marketplace: true,
        marketplaceRoot: '../marketplace',
        marketplaceRemote: 'origin',
        marketplaceBranch: 'main',
        draft: false,
        prerelease: false,
    };

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        const nextValue = () => {
            const value = argv[i + 1];
            if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
            i += 1;
            return value;
        };

        if (arg === '--help' || arg === '-h') {
            options.help = true;
        } else if (arg === '--dry-run') {
            options.dryRun = true;
        } else if (arg === '--preflight') {
            options.preflightOnly = true;
        } else if (arg === '--no-check') {
            options.check = false;
        } else if (arg === '--only' || arg === '--target' || arg === '--targets') {
            options.only.push(...parseList(nextValue()));
        } else if (arg.startsWith('--only=')) {
            options.only.push(...parseList(arg.slice('--only='.length)));
        } else if (arg.startsWith('--target=')) {
            options.only.push(...parseList(arg.slice('--target='.length)));
        } else if (arg.startsWith('--targets=')) {
            options.only.push(...parseList(arg.slice('--targets='.length)));
        } else if (arg === '--skip' || arg === '--exclude') {
            options.skip.push(...parseList(nextValue()));
        } else if (arg.startsWith('--skip=')) {
            options.skip.push(...parseList(arg.slice('--skip='.length)));
        } else if (arg.startsWith('--exclude=')) {
            options.skip.push(...parseList(arg.slice('--exclude='.length)));
        } else if (arg === '--tag') {
            options.tag = nextValue();
        } else if (arg.startsWith('--tag=')) {
            options.tag = arg.slice('--tag='.length);
        } else if (arg === '--npm-tag') {
            options.npmTag = nextValue();
        } else if (arg.startsWith('--npm-tag=')) {
            options.npmTag = arg.slice('--npm-tag='.length);
        } else if (arg === '--otp') {
            options.otp = nextValue();
        } else if (arg.startsWith('--otp=')) {
            options.otp = arg.slice('--otp='.length);
        } else if (arg === '--github-remote') {
            options.githubRemote = nextValue();
        } else if (arg.startsWith('--github-remote=')) {
            options.githubRemote = arg.slice('--github-remote='.length);
        } else if (arg === '--gitlab-remote') {
            options.gitlabRemote = nextValue();
        } else if (arg.startsWith('--gitlab-remote=')) {
            options.gitlabRemote = arg.slice('--gitlab-remote='.length);
        } else if (arg === '--github-repo') {
            options.githubRepo = nextValue();
        } else if (arg.startsWith('--github-repo=')) {
            options.githubRepo = arg.slice('--github-repo='.length);
        } else if (arg === '--gitlab-repo') {
            options.gitlabRepo = nextValue();
        } else if (arg.startsWith('--gitlab-repo=')) {
            options.gitlabRepo = arg.slice('--gitlab-repo='.length);
        } else if (arg === '--marketplace-root') {
            options.marketplaceRoot = nextValue();
        } else if (arg.startsWith('--marketplace-root=')) {
            options.marketplaceRoot = arg.slice('--marketplace-root='.length);
        } else if (arg === '--marketplace-remote') {
            options.marketplaceRemote = nextValue();
        } else if (arg.startsWith('--marketplace-remote=')) {
            options.marketplaceRemote = arg.slice('--marketplace-remote='.length);
        } else if (arg === '--marketplace-branch') {
            options.marketplaceBranch = nextValue();
        } else if (arg.startsWith('--marketplace-branch=')) {
            options.marketplaceBranch = arg.slice('--marketplace-branch='.length);
        } else if (arg === '--skip-marketplace') {
            options.marketplace = false;
        } else if (arg === '--draft') {
            options.draft = true;
        } else if (arg === '--prerelease') {
            options.prerelease = true;
        } else {
            throw new Error(`Unknown argument: ${arg}\n\n${usage()}`);
        }
    }

    const only = options.only.map(normalizeTarget);
    const skip = new Set(options.skip.map(normalizeTarget));
    let targets = only.length > 0 && !only.includes('all') ? only : targetsAll;
    targets = targetsAll.filter((target) => targets.includes(target) && !skip.has(target));
    for (const target of only) {
        if (target !== 'all' && !targetsAll.includes(target)) {
            throw new Error(`Unknown release target: ${target}. Expected one of: ${targetsAll.join(', ')}`);
        }
    }
    if (targets.length === 0) throw new Error('No release targets selected.');
    return { ...options, targets };
}

function commandLine(command, args) {
    return [command, ...args].map((part) => (/\s/.test(part) ? JSON.stringify(part) : part)).join(' ');
}

function run(command, args, options = {}) {
    const line = commandLine(command, args);
    if (options.dryRun && options.mutates) {
        console.log(`[dry-run] ${line}`);
        return options.allowFailure ? { ok: true, stdout: '', stderr: '', status: 0, dryRun: true } : '';
    }
    const result = spawnSync(command, args, {
        cwd: options.cwd || process.cwd(),
        encoding: 'utf8',
        env: options.env ? { ...process.env, ...options.env } : process.env,
        stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    });
    if (result.status !== 0) {
        if (options.allowFailure) {
            return { ok: false, stdout: result.stdout || '', stderr: result.stderr || '', status: result.status };
        }
        const detail = options.capture ? `\n${result.stderr || result.stdout || ''}` : '';
        throw new Error(`Command failed: ${line}${detail}`);
    }
    if (options.allowFailure) {
        return { ok: true, stdout: result.stdout || '', stderr: result.stderr || '', status: result.status };
    }
    return options.capture ? result.stdout.trim() : '';
}

function runNpm(args, options = {}) {
    return run('npm', args, {
        ...options,
        env: { ...options.env, npm_config_cache: RELEASE_NPM_CACHE },
    });
}

function cleanStatus(cwd = process.cwd()) {
    return run('git', ['status', '--short'], { capture: true, cwd });
}

function ensureCleanWorktree(options, cwd = process.cwd(), label = 'Source') {
    const status = cleanStatus(cwd);
    if (!status) return;
    if (options.dryRun) {
        console.warn(`[dry-run] ${label} worktree is dirty; real release would stop:\n${status}`);
        return;
    }
    throw new Error(`${label} worktree is not clean. Commit or stash changes before release.\n${status}`);
}

function currentBranch(cwd = process.cwd()) {
    const branch = run('git', ['branch', '--show-current'], { capture: true, cwd });
    if (!branch) throw new Error(`Cannot release from a detached HEAD: ${cwd}`);
    return branch;
}

function headCommit(cwd = process.cwd()) {
    return run('git', ['rev-parse', 'HEAD'], { capture: true, cwd });
}

function tagExists(tag, cwd = process.cwd()) {
    return spawnSync('git', ['rev-parse', '--verify', `refs/tags/${tag}`], { cwd, stdio: 'ignore' }).status === 0;
}

function tagCommit(tag, cwd = process.cwd()) {
    return run('git', ['rev-list', '-n', '1', tag], { capture: true, cwd });
}

function ensureTag(tag, commit, options) {
    if (!tagExists(tag)) {
        run('git', ['tag', '-a', tag, commit, '-m', `Release ${tag}`], { mutates: true, dryRun: options.dryRun });
        return;
    }
    const existingCommit = tagCommit(tag);
    if (existingCommit !== commit) {
        throw new Error(`Tag ${tag} points to ${existingCommit}, expected ${commit}. Bump the package version; do not reuse a release tag.`);
    }
}

function remoteRefs(remote, refs, cwd = process.cwd()) {
    const result = run('git', ['ls-remote', remote, ...refs], { capture: true, allowFailure: true, cwd });
    if (!result.ok) throw new Error(`Cannot read git remote ${remote}.\n${result.stderr || result.stdout}`);
    const values = new Map();
    for (const line of result.stdout.trim().split(/\r?\n/).filter(Boolean)) {
        const [sha, ref] = line.split(/\s+/);
        values.set(ref, sha);
    }
    return values;
}

function remoteTagCommit(remote, tag, cwd = process.cwd()) {
    const tagRef = `refs/tags/${tag}`;
    const peeledRef = `${tagRef}^{}`;
    const refs = remoteRefs(remote, [tagRef, peeledRef], cwd);
    return refs.get(peeledRef) || refs.get(tagRef);
}

function verifyRemoteBranch(remote, branch, commit, cwd = process.cwd()) {
    const ref = `refs/heads/${branch}`;
    const actual = remoteRefs(remote, [ref], cwd).get(ref);
    if (actual !== commit) throw new Error(`Remote ${remote}/${branch} is ${actual || 'missing'}, expected ${commit}.`);
}

function verifyRemoteTag(remote, tag, commit, cwd = process.cwd()) {
    const actual = remoteTagCommit(remote, tag, cwd);
    if (actual !== commit) throw new Error(`Remote ${remote} tag ${tag} is ${actual || 'missing'}, expected ${commit}.`);
}

function ensureRemoteTagCompatible(remote, tag, commit, cwd = process.cwd()) {
    run('git', ['remote', 'get-url', remote], { capture: true, cwd });
    const actual = remoteTagCommit(remote, tag, cwd);
    if (actual && actual !== commit) {
        throw new Error(`Remote ${remote} tag ${tag} points to ${actual}, expected ${commit}. Bump the version instead of replacing the tag.`);
    }
    return actual;
}

function pushBranch(remote, branch, commit, options, cwd = process.cwd()) {
    run('git', ['push', remote, branch], { mutates: true, dryRun: options.dryRun, cwd });
    if (!options.dryRun) verifyRemoteBranch(remote, branch, commit, cwd);
}

function pushSource(remote, branch, tag, commit, options) {
    pushBranch(remote, branch, commit, options);
    run('git', ['push', remote, tag], { mutates: true, dryRun: options.dryRun });
    if (!options.dryRun) verifyRemoteTag(remote, tag, commit);
}

function releaseCommitRange() {
    const previous = run('git', ['describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*', 'HEAD^'], { capture: true, allowFailure: true });
    return previous.ok && previous.stdout.trim() ? `${previous.stdout.trim()}..HEAD` : undefined;
}

function releaseAssets() {
    return [
        { path: 'dist/manifest.json', label: 'manifest.json' },
        { path: 'dist/checksums.txt', label: 'checksums.txt' },
        { path: 'dist/INSTALL.md', label: 'INSTALL.md' },
    ];
}

function ensureAssets(options) {
    if (options.dryRun) return;
    const missing = releaseAssets().filter((asset) => !fs.existsSync(asset.path));
    if (missing.length > 0) {
        throw new Error(`Missing release assets. Run npm run release:prepare first.\n${missing.map((asset) => `- ${asset.path}`).join('\n')}`);
    }
}

function labeledAssetArgs() {
    return releaseAssets().map((asset) => `${asset.path}#${asset.label}`);
}

function releaseNotesFile(tag, pkg) {
    const range = releaseCommitRange();
    const commits = range ? run('git', ['log', '--oneline', '--no-merges', range], { capture: true }).split(/\r?\n/).filter(Boolean) : [];
    const changeLines = commits.length > 0 ? commits.map((line) => `- ${line}`) : ['- See repository history for details.'];
    const content = [
        `# ${tag}`,
        '',
        '## Package',
        `- \`${pkg.name}@${pkg.version}\``,
        '',
        '## Artifacts',
        '- `manifest.json`: release artifact map.',
        '- `checksums.txt`: SHA-256 checksums.',
        '- `INSTALL.md`: installation and vendoring notes.',
        '',
        '## Install',
        '',
        '```bash',
        `npm install -D ${pkg.name}`,
        '```',
        '',
        '## Changes',
        ...changeLines,
        '',
    ].join('\n');
    const file = path.join(os.tmpdir(), `${pkg.name}-${tag}-release-notes.md`);
    fs.writeFileSync(file, content);
    return file;
}

function pluginBaseVersion(version) {
    return String(version || '').split('+')[0];
}

function validateReleaseVersions(pkg, pluginManifest) {
    if (!pkg.version) throw new Error('package.json version is missing.');
    if (pluginBaseVersion(pluginManifest.version) !== pkg.version) {
        throw new Error(`Plugin base version ${pluginBaseVersion(pluginManifest.version) || 'missing'} does not match package ${pkg.version}.`);
    }
}

function walkTree(root, relative = '') {
    const absolute = path.join(root, relative);
    const entries = fs.readdirSync(absolute, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    const files = [];
    for (const entry of entries) {
        const childRelative = relative ? path.join(relative, entry.name) : entry.name;
        const childAbsolute = path.join(root, childRelative);
        if (entry.isSymbolicLink()) throw new Error(`Release snapshots must not contain symlinks: ${childAbsolute}`);
        if (entry.isDirectory()) {
            files.push(...walkTree(root, childRelative));
        } else if (entry.isFile()) {
            const stat = fs.statSync(childAbsolute);
            files.push({
                path: childRelative.split(path.sep).join('/'),
                bytes: stat.size,
                executable: Boolean(stat.mode & 0o111),
                sha256: crypto.createHash('sha256').update(fs.readFileSync(childAbsolute)).digest('hex'),
            });
        }
    }
    return files;
}

function assertTreesEqual(expectedRoot, actualRoot) {
    const expected = walkTree(expectedRoot);
    const actual = walkTree(actualRoot);
    if (JSON.stringify(expected) !== JSON.stringify(actual)) {
        throw new Error(`Marketplace snapshot differs from the built plugin. Run npm run release:prepare.\nExpected: ${expectedRoot}\nActual: ${actualRoot}`);
    }
}

function inspectMarketplace(pkg, options) {
    if (!options.marketplace) return undefined;
    const root = path.resolve(options.marketplaceRoot);
    const catalogPath = path.join(root, '.agents', 'plugins', 'marketplace.json');
    const pluginRoot = path.join(root, 'plugins', 'math-workspace');
    const builtPluginRoot = path.resolve('dist', 'plugins', 'math-workspace');
    for (const required of [root, catalogPath, pluginRoot, builtPluginRoot]) {
        if (!fs.existsSync(required)) throw new Error(`Required marketplace release path is missing: ${required}`);
    }
    const catalog = readJson(catalogPath);
    const entry = (catalog.plugins || []).find((candidate) => candidate.name === 'math-workspace');
    if (!entry || entry.source?.source !== 'local' || entry.source?.path !== './plugins/math-workspace') {
        throw new Error('Marketplace catalog must point math-workspace at ./plugins/math-workspace.');
    }
    validateReleaseVersions(pkg, readJson(path.join(pluginRoot, '.codex-plugin', 'plugin.json')));
    assertTreesEqual(builtPluginRoot, pluginRoot);
    ensureCleanWorktree(options, root, 'Marketplace');
    const branch = currentBranch(root);
    if (branch !== options.marketplaceBranch) throw new Error(`Marketplace branch is ${branch}, expected ${options.marketplaceBranch}.`);
    return { root, branch, commit: headCommit(root), remote: options.marketplaceRemote };
}

function isNpmNotFound(result) {
    if (!result || result.ok) return false;
    return /(?:E404|404 Not Found|code E404)/i.test(`${result.stderr || ''}\n${result.stdout || ''}`);
}

function npmPackagePublished(pkg) {
    const result = runNpm(['view', `${pkg.name}@${pkg.version}`, 'version', '--registry', OFFICIAL_NPM_REGISTRY, '--json'], { capture: true, allowFailure: true });
    if (!result.ok) {
        if (isNpmNotFound(result)) return false;
        throw new Error(`Could not determine npm publication state.\n${result.stderr || result.stdout}`);
    }
    const version = JSON.parse(result.stdout.trim() || 'null');
    if (version !== pkg.version) throw new Error(`Unexpected npm version response: ${result.stdout.trim()}`);
    return true;
}

function preflightNpm(pkg) {
    runNpm(['ping', '--registry', OFFICIAL_NPM_REGISTRY]);
    const published = npmPackagePublished(pkg);
    if (published) return { published, whoami: undefined };
    const whoami = runNpm(['whoami', '--registry', OFFICIAL_NPM_REGISTRY], { capture: true, allowFailure: true });
    if (!whoami.ok || !whoami.stdout.trim()) {
        throw new Error(`npm authentication is not ready. Run: npm login --registry=${OFFICIAL_NPM_REGISTRY}`);
    }
    console.log(`npm account: ${whoami.stdout.trim()}`);
    return { published, whoami: whoami.stdout.trim() };
}

function verifyNpmPackage(pkg) {
    const output = runNpm(['view', `${pkg.name}@${pkg.version}`, 'version', 'bin', 'dist.integrity', '--registry', OFFICIAL_NPM_REGISTRY, '--json'], { capture: true });
    const data = JSON.parse(output);
    const integrity = data['dist.integrity'] || data.dist?.integrity;
    if (data.version !== pkg.version) throw new Error(`npm readback version is ${data.version}, expected ${pkg.version}.`);
    if (data.bin?.['math-workspace'] !== 'out/cli/math-workspace.js') throw new Error('npm readback does not expose the expected math-workspace CLI bin.');
    if (!integrity) throw new Error('npm readback is missing dist.integrity.');
    console.log(`npm verified: ${pkg.name}@${pkg.version}`);
}

function publishNpm(pkg, options, alreadyPublished) {
    if (alreadyPublished) {
        console.log(`npm package already published: ${pkg.name}@${pkg.version}`);
    } else {
        const args = ['publish', '--registry', OFFICIAL_NPM_REGISTRY, '--access', 'public'];
        if (options.npmTag) args.push('--tag', options.npmTag);
        if (options.otp) args.push('--otp', options.otp);
        runNpm(args, { mutates: true, dryRun: options.dryRun });
    }
    if (!options.dryRun) verifyNpmPackage(pkg);
}

function releaseGithub(tag, notesFile, options) {
    const assets = labeledAssetArgs();
    if (options.dryRun) {
        const args = ['release', 'create', tag, ...assets, '--repo', options.githubRepo, '--verify-tag', '--latest', '--title', tag, '--notes-file', '<generated>'];
        if (options.draft) args.push('--draft');
        if (options.prerelease) args.push('--prerelease');
        run('gh', args, { mutates: true, dryRun: true });
        return;
    }
    const existing = run('gh', ['release', 'view', tag, '--repo', options.githubRepo, '--json', 'url'], { capture: true, allowFailure: true });
    if (existing.ok) {
        console.log(`GitHub release already exists: ${JSON.parse(existing.stdout).url}`);
        return;
    }
    const args = ['release', 'create', tag, ...assets, '--repo', options.githubRepo, '--verify-tag', '--latest', '--title', tag, '--notes-file', notesFile];
    if (options.draft) args.push('--draft');
    if (options.prerelease) args.push('--prerelease');
    run('gh', args, { mutates: true });
    const created = run('gh', ['release', 'view', tag, '--repo', options.githubRepo, '--json', 'url'], { capture: true });
    console.log(`GitHub release verified: ${JSON.parse(created).url}`);
}

function releaseGitlab(tag, notesFile, options) {
    const assets = labeledAssetArgs();
    if (options.dryRun) {
        run('glab', ['release', 'create', tag, ...assets, '--repo', options.gitlabRepo, '--name', tag, '--notes-file', '<generated>', '--no-update'], { mutates: true, dryRun: true });
        return;
    }
    const existing = run('glab', ['release', 'view', tag, '--repo', options.gitlabRepo, '--output', 'json'], { capture: true, allowFailure: true });
    if (existing.ok) {
        console.log(`GitLab release already exists: ${tag}`);
        return;
    }
    run('glab', ['release', 'create', tag, ...assets, '--repo', options.gitlabRepo, '--name', tag, '--notes-file', notesFile, '--no-update'], { mutates: true });
    run('glab', ['release', 'view', tag, '--repo', options.gitlabRepo, '--output', 'json'], { capture: true });
    console.log(`GitLab release verified: ${tag}`);
}

function releaseOrder(options) {
    const order = [];
    if (options.marketplace) order.push('marketplace:push');
    order.push('source:tag');
    if (options.targets.includes('github')) order.push('github:push');
    if (options.targets.includes('gitlab')) order.push('gitlab:push');
    if (options.targets.includes('github')) order.push('github:release');
    if (options.targets.includes('gitlab')) order.push('gitlab:release');
    if (options.targets.includes('npm')) order.push('npm:publish');
    return order;
}

function preflightRelease(pkg, tag, commit, marketplace, options) {
    if (marketplace) {
        run('git', ['remote', 'get-url', marketplace.remote], { capture: true, cwd: marketplace.root });
        remoteRefs(marketplace.remote, [`refs/heads/${marketplace.branch}`], marketplace.root);
    }
    if (options.targets.includes('github')) {
        ensureRemoteTagCompatible(options.githubRemote, tag, commit);
        run('gh', ['auth', 'status']);
    }
    if (options.targets.includes('gitlab')) {
        ensureRemoteTagCompatible(options.gitlabRemote, tag, commit);
        run('glab', ['auth', 'status']);
    }
    if (options.targets.includes('npm') && !options.targets.some((target) => target === 'github' || target === 'gitlab')) {
        const publishedTag = [options.githubRemote, options.gitlabRemote].some((remote) => remoteTagCommit(remote, tag) === commit);
        if (!publishedTag) throw new Error('An npm-only release is recovery-only: publish the matching tag to GitHub or GitLab first, or include a Git target.');
    }
    return options.targets.includes('npm') ? preflightNpm(pkg) : { published: false };
}

function main(argv = process.argv.slice(2)) {
    const options = parseArgs(argv);
    if (options.help) {
        console.log(usage());
        return;
    }
    const pkg = readJson('package.json');
    const sourcePluginManifest = readJson(path.join('plugins', 'math-workspace', '.codex-plugin', 'plugin.json'));
    validateReleaseVersions(pkg, sourcePluginManifest);
    const tag = options.tag || `v${pkg.version}`;
    const branch = currentBranch();
    const commit = headCommit();

    console.log(`Release ${tag}: ${options.targets.join(', ')}`);
    console.log(`Mutation order: ${releaseOrder(options).join(' -> ')}`);
    ensureCleanWorktree(options);
    if (options.check) {
        run('npm', ['run', 'release:check'], { mutates: true, dryRun: options.dryRun });
        ensureCleanWorktree(options);
    }
    ensureAssets(options);
    const marketplace = inspectMarketplace(pkg, options);
    if (tagExists(tag) && tagCommit(tag) !== commit) {
        throw new Error(`Tag ${tag} already points to ${tagCommit(tag)}, expected ${commit}. Bump the package version.`);
    }

    const npmState = options.dryRun ? { published: false } : preflightRelease(pkg, tag, commit, marketplace, options);
    if (options.preflightOnly) {
        console.log(`Preflight OK: ${pkg.name}@${pkg.version}`);
        return;
    }

    const notesFile = options.dryRun ? '<generated>' : releaseNotesFile(tag, pkg);
    if (marketplace) pushBranch(marketplace.remote, marketplace.branch, marketplace.commit, options, marketplace.root);
    ensureTag(tag, commit, options);
    if (options.targets.includes('github')) pushSource(options.githubRemote, branch, tag, commit, options);
    if (options.targets.includes('gitlab')) pushSource(options.gitlabRemote, branch, tag, commit, options);
    if (options.targets.includes('github')) releaseGithub(tag, notesFile, options);
    if (options.targets.includes('gitlab')) releaseGitlab(tag, notesFile, options);
    if (options.targets.includes('npm')) publishNpm(pkg, options, npmState.published);
}

if (require.main === module) {
    try {
        main();
    } catch (error) {
        console.error(error.message);
        process.exit(1);
    }
}

module.exports = {
    OFFICIAL_NPM_REGISTRY,
    RELEASE_NPM_CACHE,
    assertTreesEqual,
    isNpmNotFound,
    parseArgs,
    pluginBaseVersion,
    releaseOrder,
    validateReleaseVersions,
};
