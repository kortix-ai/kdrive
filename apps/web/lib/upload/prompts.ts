'use client';

// Questions the upload engine asks the person (conflicts, quota). The engine
// runs outside React, so it parks a resolver here and UploadTray renders the
// ConflictDialog / QuotaDialog from this module-level store (WEB-drive state,
// not the app store).
import { create } from 'zustand';
import type { QuotaDetails } from '@volumes/shared';

export type ConflictChoice = 'keep-both' | 'replace';
/** `all`: use the choice for the rest of THIS upload (never for later drops). */
export type ConflictAnswer = { choice: ConflictChoice; all: boolean };

interface ConflictPrompt {
  paths: string[];
  resolve: (answer: ConflictAnswer | null) => void;
}

interface PromptState {
  conflict: ConflictPrompt | null;
  quota: (QuotaDetails & { fileCount: number }) | null;
}

export const useUploadPrompts = create<PromptState>()(() => ({ conflict: null, quota: null }));

/** Resolves with the person's answer, or null when they cancel the upload. */
export function askConflict(paths: string[]): Promise<ConflictAnswer | null> {
  return new Promise((resolve) => {
    const prev = useUploadPrompts.getState().conflict;
    prev?.resolve(null);
    useUploadPrompts.setState({ conflict: { paths, resolve } });
  });
}

export function answerConflict(choice: ConflictChoice | null, applyToAll = false): void {
  const cur = useUploadPrompts.getState().conflict;
  useUploadPrompts.setState({ conflict: null });
  cur?.resolve(choice ? { choice, all: applyToAll } : null);
}

export function showQuota(d: QuotaDetails, fileCount: number): void {
  useUploadPrompts.setState({ quota: { ...d, fileCount } });
}

export function closeQuota(): void {
  useUploadPrompts.setState({ quota: null });
}

/** Sign-out: closes both questions; an upload waiting on the conflict answer is cancelled. */
export function resetUploadPrompts(): void {
  const cur = useUploadPrompts.getState().conflict;
  useUploadPrompts.setState({ conflict: null, quota: null });
  cur?.resolve(null);
}
