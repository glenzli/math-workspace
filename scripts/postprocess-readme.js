const fs = require('node:fs');
const path = require('node:path');

const readmePath = path.resolve(__dirname, '..', 'README.md');
const banner = '![Math Workspace: mathematical writing, dependencies, symbols, and Lean alignment](media/readme/banner.png)';
const bannerPattern = /^!\[[^\]]*\]\(media\/readme\/banner\.png\)\s*$/gm;

const original = fs.readFileSync(readmePath, 'utf8');
const withoutBanners = original.replace(bannerPattern, '');
const firstHeading = withoutBanners.match(/^# .+$/m);

if (!firstHeading || firstHeading.index === undefined) {
    throw new Error('README.md does not contain a level-one heading');
}

const headingEnd = firstHeading.index + firstHeading[0].length;
const before = withoutBanners.slice(0, headingEnd);
const after = withoutBanners.slice(headingEnd).replace(/^(?:\r?\n)+/, '');
const updated = `${before}\n\n${banner}\n\n${after}`;

fs.writeFileSync(readmePath, updated, 'utf8');
