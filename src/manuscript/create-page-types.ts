export type CreatePageKind = 'chapter' | 'front-matter' | 'back-matter' | 'continued';
export interface CreatePageInput {
    kind: CreatePageKind;
    title: string;
    /** Exact project-relative directory returned by manuscriptCreationScopes; '.' is the project root. */
    container: string;
    slug?: string;
}
export interface ManuscriptCreationScope {
    container: string;
    kind: 'project' | 'book' | 'volume' | 'formal';
    title: string;
    label: string;
    bookKey?: string;
    volumeKey?: string;
}
export interface ManuscriptPagePlan {
    kind: CreatePageKind;
    title: string;
    container: string;
    filePath: string;
    exists: boolean;
    existingFile?: string;
    existingTitle?: string;
    scope: ManuscriptCreationScope;
    stateToken: string;
}
export interface CreatedManuscriptPage extends ManuscriptPagePlan {
    created: true;
    id: string;
}
