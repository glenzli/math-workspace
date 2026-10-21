import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { assemblePluginSnapshot, stageSourcePluginRuntime, syncPluginToMarketplace } from './plugin-release';

const ROOT = process.cwd();
const DIST_DIR = path.join(ROOT, 'dist');

function parseReleaseArgs(args: string[]): { marketplaceRoot?: string; stagePluginRuntime?: boolean } {
    let marketplaceRoot: string | undefined;
    let stagePluginRuntime = false;
    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        if (arg === '--marketplace-root') {
            marketplaceRoot = args[++index];
            if (!marketplaceRoot) throw new Error('--marketplace-root requires a directory.');
            continue;
        }
        if (arg.startsWith('--marketplace-root=')) {
            marketplaceRoot = arg.slice('--marketplace-root='.length);
            continue;
        }
        if (arg === '--stage-plugin-runtime') {
            stagePluginRuntime = true;
            continue;
        }
        throw new Error(`Unknown release option: ${arg}`);
    }
    return {
        marketplaceRoot: marketplaceRoot ? path.resolve(ROOT, marketplaceRoot) : undefined,
        stagePluginRuntime
    };
}

async function readJson(filePath: string): Promise<any> {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function pathExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch (_err) {
        return false;
    }
}

async function cleanDir(dir: string): Promise<void> {
    await fs.rm(dir, { recursive: true, force: true });
    await fs.mkdir(dir, { recursive: true });
}

async function copyFile(src: string, dest: string): Promise<void> {
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(src, dest);
}

async function copyDir(src: string, dest: string): Promise<void> {
    const entries = await fs.readdir(src, { withFileTypes: true });
    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            await copyDir(srcPath, destPath);
        } else if (entry.isFile()) {
            await copyFile(srcPath, destPath);
        }
    }
}

async function copyPublicDocs(destDocs: string): Promise<void> {
    const publicDocs = ['install.md', 'usage.md', 'release.md'];
    for (const fileName of publicDocs) {
        await copyFile(path.join(ROOT, 'docs', fileName), path.join(destDocs, fileName));
    }
}

async function writeText(filePath: string, content: string): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content.endsWith('\n') ? content : `${content}\n`, 'utf8');
}

async function writeJson(filePath: string, value: any): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function makeCliPackageJson(pkg: any): any {
    return {
        name: `${pkg.name}-cli`,
        version: pkg.version,
        private: true,
        license: pkg.license,
        repository: pkg.repository,
        description: 'CLI and local Math Workspace artifacts for math-workspace',
        bin: {
            'math-workspace': 'out/cli/math-workspace.js'
        },
        scripts: {
            formal: 'node out/cli/math-workspace.js'
        }
    };
}

async function requiredPath(filePath: string): Promise<void> {
    if (!(await pathExists(filePath))) {
        throw new Error(`Missing required release input: ${path.relative(ROOT, filePath)}`);
    }
}

async function collectFiles(dir: string): Promise<string[]> {
    const result: string[] = [];
    async function walk(current: string) {
        const entries = await fs.readdir(current, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                await walk(fullPath);
            } else if (entry.isFile()) {
                result.push(fullPath);
            }
        }
    }
    await walk(dir);
    return result.sort((a, b) => toPosix(path.relative(dir, a)).localeCompare(toPosix(path.relative(dir, b))));
}

function toPosix(filePath: string): string {
    return filePath.split(path.sep).join('/');
}

async function sha256(filePath: string): Promise<string> {
    const hash = crypto.createHash('sha256');
    hash.update(await fs.readFile(filePath));
    return hash.digest('hex');
}

async function writeChecksums(releaseRoot: string): Promise<void> {
    const files = await collectFiles(releaseRoot);
    const lines = [];
    for (const file of files) {
        const rel = toPosix(path.relative(releaseRoot, file));
        if (rel === 'checksums.txt') continue;
        lines.push(`${await sha256(file)}  ${rel}`);
    }
    await fs.writeFile(path.join(releaseRoot, 'checksums.txt'), `${lines.join('\n')}\n`, 'utf8');
}

function releaseInstallDoc(pkg: any): string {
    return `# ${pkg.name} ${pkg.version}

Language: [English](#english) | [中文](#中文)

<a id="english"></a>

## English

Choose the tool provider to match the installation. Codex users use the plugin's bundled CLI, Reader and generic skills. Independent users use Math Workspace's own CLI/npm; Codex is not required.

### Codex plugin

Register this release as a marketplace and install the self-contained plugin:

\`\`\`bash
codex plugin marketplace add /path/to/math-workspace-release
codex plugin add math-workspace@personal
\`\`\`

Start a new Codex task after installation or updates. Reuse the installed plugin's actual launcher or Node/CLI entry for initialization and file operations. Keep project configuration, source, review records and project-specific rules in the project. Do not copy a second runtime into \`tools/math-workspace\`, add a second npm dependency, or embed generic skill copies just to use the Codex plugin.

### Independent CLI

For terminal, CI or other-host use, manage the release CLI outside the writing project or explicitly select the standalone npm package. For example:

\`\`\`bash
node /absolute/path/to/math-workspace-release/cli/out/cli/math-workspace.js open /path/to/project
\`\`\`

The Reader binds only to \`127.0.0.1\`. The standalone CLI uses the same project file formats and does not require Codex. Keep one selected runtime version per workflow.

### Artifacts and rules

- \`.agents/plugins/\` and \`plugins/\`: the Codex marketplace and self-contained plugin.
- \`cli/\`: the standalone CLI and Reader runtime.
- \`skills/\`: reviewed generic rules for explicit standalone integration; Codex projects read the installed plugin skills.
- \`vasm-catalog/\`: optional hash-lockable exports for explicit artifact/VASMC consumers.
- \`docs/\`, \`manifest.json\`, \`checksums.txt\`: public documentation, artifact map and SHA-256 checksums.

Keep project-specific axioms, terminology and stricter requirements in native project instructions. Preserve configuration, review decisions and evidence records when updating tools. See \`docs/install.md\` for complete setup choices.

<a id="中文"></a>

## 中文

按安装方式选择工具来源：通过 Codex 使用时，复用插件自带的 CLI、Reader 和通用 skills；独立使用时，走 Math Workspace 自己的 CLI/npm，无需安装 Codex。

### Codex 插件

把本 release 注册为 marketplace，再安装自包含插件：

\`\`\`bash
codex plugin marketplace add /path/to/math-workspace-release
codex plugin add math-workspace@personal
\`\`\`

安装或更新后新建 Codex 任务。初始化和文件操作复用已安装插件的实际启动器或 Node/CLI 入口。项目保留配置、源稿、审阅记录和特化规则；不要仅为使用 Codex 插件再内置 \`tools/math-workspace\`、添加第二份 npm 依赖或复制通用 skills。

### 独立 CLI

终端、CI 或其他宿主可在写作项目之外管理 release CLI，或明确选择独立 npm 包。例如：

\`\`\`bash
node /absolute/path/to/math-workspace-release/cli/out/cli/math-workspace.js open /path/to/project
\`\`\`

Reader 只绑定 \`127.0.0.1\`。独立 CLI 使用同一项目文件格式，不依赖 Codex；同一流程明确使用一份已选运行时。

### 产物与规则

- \`.agents/plugins/\` 与 \`plugins/\`：Codex marketplace 和自包含插件。
- \`cli/\`：独立 CLI 与 Reader 运行时。
- \`skills/\`：供独立接入时审阅的通用规则；Codex 项目读取已安装插件的 skills。
- \`vasm-catalog/\`：供明确采用 artifact/VASMC 分发的消费者锁定所需 exports。
- \`docs/\`、\`manifest.json\`、\`checksums.txt\`：公开文档、产物表与 SHA-256 校验和。

项目自己的公理、术语和更严格约束留在原生规则中；工具更新保留配置、人工审阅与证据记录。完整接入选择见 \`docs/install.md\`。
`;
}

async function main(): Promise<void> {
    const options = parseReleaseArgs(process.argv.slice(2));
    if (options.stagePluginRuntime) {
        const staged = await stageSourcePluginRuntime(ROOT);
        console.log(`OK plugin runtime: ${toPosix(path.relative(ROOT, staged))}`);
        return;
    }

    const pkg = await readJson(path.join(ROOT, 'package.json'));
    const releaseRoot = DIST_DIR;
    const cliRoot = path.join(releaseRoot, 'cli');
    const catalogRoot = path.join(ROOT, 'vasm-catalog');
    const marketplaceRoot = path.join(ROOT, '.agents', 'plugins');
    const pluginRoot = path.join(ROOT, 'plugins');

    await requiredPath(path.join(ROOT, 'out', 'cli', 'math-workspace.js'));
    await requiredPath(path.join(ROOT, 'out', 'cli', 'release.js'));
    await requiredPath(path.join(ROOT, 'out', 'reader', 'index.html'));
    await requiredPath(path.join(ROOT, 'skills', 'editor.md'));
    await requiredPath(path.join(ROOT, 'skills', 'math-writing.md'));
    await requiredPath(path.join(ROOT, 'skills', 'integrator.md'));
    await requiredPath(path.join(ROOT, 'skills', 'lean-formalization.md'));
    await requiredPath(path.join(catalogRoot, 'vasmc-catalog.yaml'));
    await requiredPath(path.join(ROOT, 'README.md'));
    await requiredPath(path.join(ROOT, 'LICENSE'));
    await requiredPath(path.join(ROOT, 'docs', 'usage.md'));
    await requiredPath(path.join(ROOT, 'docs', 'release.md'));
    await requiredPath(path.join(marketplaceRoot, 'marketplace.json'));
    await requiredPath(path.join(pluginRoot, 'math-workspace', '.codex-plugin', 'plugin.json'));
    await requiredPath(path.join(pluginRoot, 'math-workspace', 'scripts', 'launch_math_workspace_mcp'));

    await cleanDir(releaseRoot);

    await copyFile(path.join(ROOT, 'README.md'), path.join(releaseRoot, 'README.md'));
    await copyFile(path.join(ROOT, 'LICENSE'), path.join(releaseRoot, 'LICENSE'));
    await copyDir(path.join(ROOT, 'media', 'readme'), path.join(releaseRoot, 'media', 'readme'));
    await copyDir(path.join(ROOT, 'skills'), path.join(releaseRoot, 'skills'));
    await copyDir(marketplaceRoot, path.join(releaseRoot, '.agents', 'plugins'));
    const pluginSnapshotRoot = await assemblePluginSnapshot(
        ROOT,
        path.join(releaseRoot, 'plugins', 'math-workspace')
    );
    await copyDir(catalogRoot, path.join(releaseRoot, 'vasm-catalog'));
    await copyPublicDocs(path.join(releaseRoot, 'docs'));
    await writeText(path.join(releaseRoot, 'INSTALL.md'), releaseInstallDoc(pkg));

    await writeJson(path.join(cliRoot, 'package.json'), makeCliPackageJson(pkg));
    await copyDir(path.join(ROOT, 'out', 'cli'), path.join(cliRoot, 'out', 'cli'));
    await copyDir(path.join(ROOT, 'out', 'reader'), path.join(cliRoot, 'out', 'reader'));
    await copyDir(path.join(ROOT, 'skills'), path.join(cliRoot, 'skills'));
    await copyDir(catalogRoot, path.join(cliRoot, 'vasm-catalog'));
    await copyPublicDocs(path.join(cliRoot, 'docs'));
    await copyFile(path.join(ROOT, 'LICENSE'), path.join(cliRoot, 'LICENSE'));

    await writeJson(path.join(releaseRoot, 'manifest.json'), {
        name: pkg.name,
        version: pkg.version,
        generatedAt: new Date().toISOString(),
        artifacts: {
            reader: {
                path: 'cli/out/reader',
                serve: 'node cli/out/cli/math-workspace.js serve /path/to/project',
                mode: 'Primary local read-only interface, bound to 127.0.0.1'
            },
            cli: {
                path: 'cli',
                entry: 'out/cli/math-workspace.js',
                bin: 'math-workspace',
                skillsPath: 'cli/skills',
                vasmCatalogPath: 'cli/vasm-catalog/vasmc-catalog.yaml',
                install: 'Codex installations use the plugin runtime; independent users run this CLI from their selected standalone installation.'
            },
            codexMcpPlugin: {
                marketplace: '.agents/plugins/marketplace.json',
                plugin: 'plugins/math-workspace',
                command: './scripts/launch_math_workspace_mcp mcp',
                mode: 'Self-contained Codex MCP plugin with bundled CLI and Reader runtime; no global math-workspace command is required.'
            },
            skills: {
                path: 'skills',
                cliPath: 'cli/skills',
                mode: 'Codex projects reference installed plugin skills; explicit standalone consumers review these artifacts and preserve project-specific rules'
            },
            vasmCatalog: {
                path: 'vasm-catalog',
                index: 'vasm-catalog/vasmc-catalog.yaml',
                mode: 'VASMC catalog exports; consume with vasmc add --catalog and commit the consumer lockfile.'
            },
            docs: {
                path: 'docs'
            }
        }
    });

    await writeChecksums(releaseRoot);

    if (options.marketplaceRoot) {
        const published = await syncPluginToMarketplace(pluginSnapshotRoot, options.marketplaceRoot);
        console.log(`Marketplace plugin: ${toPosix(published)}`);
    }

    console.log(`OK release: ${toPosix(path.relative(ROOT, releaseRoot))}`);
    console.log(`Manifest: ${toPosix(path.relative(ROOT, path.join(releaseRoot, 'manifest.json')))}`);
    console.log(`Checksums: ${toPosix(path.relative(ROOT, path.join(releaseRoot, 'checksums.txt')))}`);
}

main().catch(err => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
});
