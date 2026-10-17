const fs = require('node:fs');
const path = require('node:path');

const banner = '![Math Workspace Reader：数学正文、稳定引用与书卷导航](https://raw.githubusercontent.com/glenzli/math-workspace/main/media/readme/banner.jpg)';
const bannerPattern = /^!\[[^\]]*\]\((?:https:\/\/raw\.githubusercontent\.com\/glenzli\/math-workspace\/main\/)?media\/readme\/banner\.(?:png|jpe?g)\)$/;
const languageAnchorPattern = /^<a (?:name|id)=(['"])(zh-cn|en)\1><\/a>$/;
const languageNavigationPattern = /^\[[^\]]+\]\(#(?:zh-cn|en)\)\s*\|\s*\[[^\]]+\]\(#(?:zh-cn|en)\)$/;
const headingPattern = /^( {0,3})(#{1,6})([ \t]+.+)$/;
const reciprocalLinks = new Set(['[English](#en)', '[中文](#zh-cn)']);

// Keep fenced examples and display math out of structural rewrites.
function documentLines(markdown) {
    let fence;
    let mathEnd;
    return markdown.replace(/\r\n/g, '\n').split('\n').map(text => {
        if (fence) {
            const closing = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(text);
            if (closing && closing[1][0] === fence[0] && closing[1].length >= fence.length) fence = undefined;
            return { text, editable: false };
        }
        if (mathEnd) {
            if (text.trim() === mathEnd) mathEnd = undefined;
            return { text, editable: false };
        }
        const opening = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(text);
        if (opening && (opening[1][0] !== '`' || !opening[2].includes('`'))) {
            fence = opening[1];
            return { text, editable: false };
        }
        if (text.trim() === '$$' || text.trim() === '\\[') {
            mathEnd = text.trim() === '$$' ? '$$' : '\\]';
            return { text, editable: false };
        }
        return { text, editable: true };
    });
}

function trimEmptyLines(lines) {
    while (lines.length && !lines[0].text.trim()) lines.shift();
    while (lines.length && !lines.at(-1).text.trim()) lines.pop();
    return lines;
}

function sectionBody(lines, language, followedBySection) {
    const body = trimEmptyLines(lines.slice());
    const titles = language === 'zh-cn' ? ['## 中文', '## 🇨🇳 中文'] : ['## English', '## 🌍 English'];
    if (!body[0]?.editable || !titles.includes(body[0].text.trim())) {
        throw new Error(`README.md has an unexpected ${language} language heading`);
    }
    body.shift();
    trimEmptyLines(body);
    if (followedBySection && body.at(-1)?.editable && body.at(-1).text.trim() === '---') body.pop();
    const content = trimEmptyLines(body.filter(line => !line.editable ||
        (!bannerPattern.test(line.text.trim()) && !reciprocalLinks.has(line.text.trim()))));
    if (!content.length) throw new Error(`README.md has an empty ${language} language section`);

    // VASMC preserves translated headings; normalize source H2s once beneath the language H2.
    const headings = content.filter(line => line.editable).map(line => headingPattern.exec(line.text)).filter(Boolean);
    const shallowest = Math.min(...headings.map(heading => heading[2].length));
    const shift = Math.max(0, 3 - shallowest);
    if (headings.some(heading => heading[2].length + shift > 6)) {
        throw new Error(`README.md ${language} headings exceed Markdown's six levels`);
    }
    return content.map(line => line.editable && shift ? line.text.replace(headingPattern,
        (_, indent, hashes, rest) => indent + '#'.repeat(hashes.length + shift) + rest) : line.text).join('\n');
}

function postprocessReadme(markdown) {
    const lines = documentLines(markdown);
    const titleIndex = lines.findIndex(line => line.editable && /^# .+$/.test(line.text));
    if (titleIndex < 0) throw new Error('README.md does not contain a level-one heading');
    const anchors = lines.flatMap((line, index) => {
        const match = line.editable && languageAnchorPattern.exec(line.text.trim());
        return match ? [{ language: match[2], index }] : [];
    });
    if (anchors.length !== 2 || new Set(anchors.map(anchor => anchor.language)).size !== 2) {
        throw new Error('README.md must contain exactly one Chinese and one English language anchor');
    }
    if (titleIndex >= anchors[0].index || lines.slice(0, anchors[0].index).some((line, index) =>
        line.text.trim() && index !== titleIndex && (!line.editable ||
            (!bannerPattern.test(line.text.trim()) && !languageNavigationPattern.test(line.text.trim()) && line.text.trim() !== '---')))) {
        throw new Error('README.md contains unexpected content before its language sections');
    }
    const sections = new Map(anchors.map((anchor, index) => [anchor.language,
        sectionBody(lines.slice(anchor.index + 1, anchors[index + 1]?.index), anchor.language, index < anchors.length - 1)]));
    return [
        '# Math Workspace', '', banner, '', '[中文](#zh-cn) | [English](#en)', '', '---', '',
        '<a id="zh-cn"></a>', '', '## 中文', '', sections.get('zh-cn'), '', '[English](#en)', '', '---', '',
        '<a id="en"></a>', '', '## English', '', sections.get('en'), '', '[中文](#zh-cn)', ''
    ].join('\n');
}

if (require.main === module) {
    const readmePath = path.resolve(__dirname, '..', 'README.md');
    const original = fs.readFileSync(readmePath, 'utf8');
    const updated = postprocessReadme(original);
    if (updated !== original) fs.writeFileSync(readmePath, updated, 'utf8');
}

module.exports = { postprocessReadme };
