import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
    OFFICIAL_NPM_REGISTRY,
    RELEASE_NPM_CACHE,
    assertTreesEqual,
    isNpmNotFound,
    parseArgs,
    pluginBaseVersion,
    releaseOrder,
    validateReleaseVersions,
} = require('../scripts/publish-release.js');

test('default release targets use the official registry and publish npm last', () => {
    const options = parseArgs([]);
    assert.equal(OFFICIAL_NPM_REGISTRY, 'https://registry.npmjs.org');
    assert.equal(RELEASE_NPM_CACHE, '/private/tmp/math-workspace-npm-cache');
    assert.deepEqual(options.targets, ['github', 'gitlab', 'npm']);
    assert.equal(options.marketplaceRoot, '../marketplace');
    assert.deepEqual(releaseOrder(options), [
        'marketplace:push',
        'source:tag',
        'github:push',
        'gitlab:push',
        'github:release',
        'gitlab:release',
        'npm:publish',
    ]);
});

test('release arguments support preflight and an explicit marketplace exception', () => {
    const options = parseArgs([
        '--preflight',
        '--only',
        'npmjs',
        '--skip-marketplace',
        '--marketplace-root',
        '/tmp/catalog',
        '--marketplace-remote=public',
        '--marketplace-branch',
        'release',
    ]);
    assert.equal(options.preflightOnly, true);
    assert.deepEqual(options.targets, ['npm']);
    assert.equal(options.marketplace, false);
    assert.equal(options.marketplaceRoot, '/tmp/catalog');
    assert.equal(options.marketplaceRemote, 'public');
    assert.equal(options.marketplaceBranch, 'release');
    assert.deepEqual(releaseOrder(options), ['source:tag', 'npm:publish']);
});

test('release arguments reject unknown or empty target sets', () => {
    assert.throws(() => parseArgs(['--only', 'warehouse']), /Unknown release target/);
    assert.throws(() => parseArgs(['--skip', 'github,gitlab,npm']), /No release targets selected/);
});

test('plugin cachebuster metadata retains the package release version', () => {
    assert.equal(pluginBaseVersion('0.2.0+codex.20260828123000'), '0.2.0');
    assert.doesNotThrow(() => validateReleaseVersions(
        { version: '0.2.0' },
        { version: '0.2.0+codex.20260828123000' },
    ));
    assert.throws(
        () => validateReleaseVersions({ version: '0.2.0' }, { version: '0.1.0+codex.1' }),
        /does not match package 0.2.0/,
    );
});

test('npm lookup distinguishes an unpublished package from authentication failure', () => {
    assert.equal(isNpmNotFound({ ok: false, stderr: 'npm error code E404' }), true);
    assert.equal(isNpmNotFound({ ok: false, stderr: 'npm error code E401' }), false);
    assert.equal(isNpmNotFound({ ok: true, stdout: '0.2.0' }), false);
});

test('marketplace tree comparison includes bytes, executable bits, and symlink rejection', (t) => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'math-workspace-release-test-'));
    t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
    const expected = path.join(temporaryRoot, 'expected');
    const actual = path.join(temporaryRoot, 'actual');
    fs.mkdirSync(path.join(expected, 'bin'), { recursive: true });
    fs.mkdirSync(path.join(actual, 'bin'), { recursive: true });
    fs.writeFileSync(path.join(expected, 'bin', 'tool'), '#!/bin/sh\n');
    fs.writeFileSync(path.join(actual, 'bin', 'tool'), '#!/bin/sh\n');
    fs.chmodSync(path.join(expected, 'bin', 'tool'), 0o755);
    fs.chmodSync(path.join(actual, 'bin', 'tool'), 0o755);
    assert.doesNotThrow(() => assertTreesEqual(expected, actual));

    fs.writeFileSync(path.join(actual, 'bin', 'tool'), '#!/bin/false\n');
    assert.throws(() => assertTreesEqual(expected, actual), /Marketplace snapshot differs/);
    fs.writeFileSync(path.join(actual, 'bin', 'tool'), '#!/bin/sh\n');
    fs.chmodSync(path.join(actual, 'bin', 'tool'), 0o644);
    assert.throws(() => assertTreesEqual(expected, actual), /Marketplace snapshot differs/);

    fs.chmodSync(path.join(actual, 'bin', 'tool'), 0o755);
    fs.symlinkSync('tool', path.join(actual, 'bin', 'tool-link'));
    assert.throws(() => assertTreesEqual(expected, actual), /must not contain symlinks/);
});

test('help documents preflight, marketplace controls, and publication order', () => {
    const result = spawnSync(process.execPath, ['scripts/publish-release.js', '--help'], {
        cwd: path.resolve(import.meta.dirname, '..'),
        encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /--preflight/);
    assert.match(result.stdout, /--marketplace-root/);
    assert.match(result.stdout, /marketplace branch -> source branches\/tags -> GitHub\/GitLab releases -> npm/);
});
