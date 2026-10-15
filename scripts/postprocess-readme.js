const fs = require('node:fs');
const path = require('node:path');

const readmePath = path.resolve(__dirname, '..', 'README.md');
const banner = '![Math Workspace Reader: manuscript, references, and book navigation](https://raw.githubusercontent.com/glenzli/math-workspace/main/media/readme/banner.jpg)';
const bannerPattern = /^!\[[^\]]*\]\((?:https:\/\/raw\.githubusercontent\.com\/glenzli\/math-workspace\/main\/)?media\/readme\/banner\.(?:png|jpe?g)\)\s*$/gm;

const original = fs.readFileSync(readmePath, 'utf8');
const withoutBanners = original.replace(bannerPattern, '');
const firstHeading = withoutBanners.match(/^# .+$/m);

if (!firstHeading || firstHeading.index === undefined) {
    throw new Error('README.md does not contain a level-one heading');
}

const headingEnd = firstHeading.index + firstHeading[0].length;
const before = withoutBanners.slice(0, headingEnd).replace(/^# .+$/m, '# Math Workspace');
const after = withoutBanners.slice(headingEnd).replace(/^(?:\r?\n)+/, '');
const updated = `${before}\n\n${banner}\n\n${after}`;

fs.writeFileSync(readmePath, updated, 'utf8');
