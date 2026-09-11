/** Shared syntax and policy for formal objects. Kept browser-safe for the Reader. */
export interface FormalKindPolicy {
    aliases: string[];
    zh: string;
    en: string;
    counter?: string;
    recall?: boolean;
    dependency?: 'mainline' | 'supplemental' | 'pedagogical';
    lean?: boolean;
}

export const FORMAL_KIND_POLICIES: Record<string, FormalKindPolicy> = {
    prop: { aliases: ['命题', 'Proposition', 'Prop', 'Prop.'], zh: '命题', en: 'Proposition', counter: 'theorem', recall: true, dependency: 'mainline', lean: true },
    lemma: { aliases: ['引理', 'Lemma', 'Lem', 'Lem.'], zh: '引理', en: 'Lemma', counter: 'theorem', recall: true, dependency: 'mainline', lean: true },
    theorem: { aliases: ['定理', 'Theorem', 'Thm', 'Thm.'], zh: '定理', en: 'Theorem', counter: 'theorem', recall: true, dependency: 'mainline', lean: true },
    cor: { aliases: ['推论', 'Corollary', 'Cor', 'Cor.'], zh: '推论', en: 'Corollary', counter: 'theorem', recall: true, dependency: 'mainline', lean: true },
    def: { aliases: ['定义', 'Definition', 'Def', 'Def.'], zh: '定义', en: 'Definition' },
    remark: { aliases: ['注', 'Remark', 'Rem', 'Rem.'], zh: '注', en: 'Remark', recall: true, dependency: 'supplemental', lean: true },
    example: { aliases: ['例', 'Example', 'Ex', 'Ex.'], zh: '例', en: 'Example', counter: 'example', recall: true },
    exercise: { aliases: ['习题', '练习', 'Exercise'], zh: '习题', en: 'Exercise', counter: 'exercise', recall: true, dependency: 'pedagogical', lean: true },
    solution: { aliases: ['解答', '答案', 'Solution', 'Answer'], zh: '解答', en: 'Solution', recall: true, dependency: 'pedagogical' },
    section: { aliases: [], zh: '§', en: '§', counter: 'section' },
    equation: { aliases: ['公式', '方程', 'Equation', 'Eq', 'Eq.', 'Formula'], zh: '公式', en: 'Equation', counter: 'equation' },
    figure: { aliases: ['图', '图示', 'Figure', 'Fig', 'Fig.'], zh: '图', en: 'Figure', counter: 'figure' },
    table: { aliases: ['表', '表格', 'Table', 'Tab', 'Tab.'], zh: '表', en: 'Table', counter: 'table' }
};

export const FORMAL_TYPES = Object.keys(FORMAL_KIND_POLICIES);
export const THEOREM_COUNTER_TYPES = new Set(FORMAL_TYPES.filter(kind => FORMAL_KIND_POLICIES[kind].counter === 'theorem'));
export const DEPENDENCY_NODE_TYPES = new Set(FORMAL_TYPES.filter(kind => FORMAL_KIND_POLICIES[kind].dependency));
export const RECALL_TYPES = new Set(FORMAL_TYPES.filter(kind => FORMAL_KIND_POLICIES[kind].recall));
export const SECTION_TYPES = new Set(['section']);
export const DEFAULT_LEAN_COVERAGE_TYPES = FORMAL_TYPES.filter(kind => FORMAL_KIND_POLICIES[kind].lean);
export const HASH_ID_RE = /^h-[a-f0-9]{16,32}$/;
export const TMP_ID_RE = /^tmp-[A-Za-z0-9_-]+$/;
export const FORMAL_ID_PATTERN = '(?:h-[a-f0-9]{16,32}|tmp-[A-Za-z0-9_-]+)';

const aliases = new Map(FORMAL_TYPES.flatMap(kind => FORMAL_KIND_POLICIES[kind].aliases.map(alias => [alias.toLowerCase(), kind] as const)));
export const FORMAL_TYPE_PATTERN = [...aliases.keys()].sort((a, b) => b.length - a.length)
    .map(alias => alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
export function normalizeFormalKind(alias: string): string | undefined { return aliases.get(alias.toLowerCase()); }
export function formalDictionary(language: 'zh' | 'en'): Record<string, string> {
    return Object.fromEntries(FORMAL_TYPES.map(kind => [kind, FORMAL_KIND_POLICIES[kind][language]]));
}
export function isPedagogicalKind(kind: string): boolean { return FORMAL_KIND_POLICIES[kind]?.dependency === 'pedagogical'; }
export function isMainlineKind(kind: string): boolean { return FORMAL_KIND_POLICIES[kind]?.dependency === 'mainline'; }

/** Remove relationship metadata from a displayed/exported solution declaration. */
export function stripSolutionAssociation(text: string): string {
    return text.replace(new RegExp(`\\s*[（(](?:对应|for)\\s+@${FORMAL_ID_PATTERN}(?:\\s*[；;]\\s*([^）)]*))?[）)]`, 'i'),
        (_match, title) => title ? `（${title.trim()}）` : '');
}
