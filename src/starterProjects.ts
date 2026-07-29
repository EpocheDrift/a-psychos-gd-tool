import type { Doc } from './engine/graph';
import { blankDoc } from './blankDoc';
import { DEFAULT_DOCUMENT_ID } from './domain/documentSchema';
import { factoryDoc } from './factoryDoc';

export interface StarterProject {
  id: string;
  label: string;
  documentId: string;
  document: Doc;
}

/**
 * Human-selected starting points. Loading one replaces the current project
 * through the same validated import path as a project file.
 */
export const STARTER_PROJECTS: readonly StarterProject[] = [
  {
    id: 'blank',
    label: 'Blank project',
    documentId: DEFAULT_DOCUMENT_ID,
    document: blankDoc,
  },
  {
    id: 'factory-poster',
    label: 'Layered poster example',
    documentId: 'example_factory_poster',
    document: factoryDoc,
  },
];

export function getStarterProject(id: string): StarterProject | undefined {
  return STARTER_PROJECTS.find((project) => project.id === id);
}
