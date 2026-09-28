'use client';

// Questions the upload engine asks the person (conflicts, quota). The engine
// runs outside React, so it parks a resolver here and UploadTray renders the
// ConflictDialog / QuotaDialog from this module-level store (WEB-drive state,
// not the app store).
import { create } from 'zustand';
import type { QuotaDetails } from '@volumes/shared';

export type ConflictChoice = 'keep-both' | 'replace';

interface ConflictPrompt {
  paths: string[];
  resolve: (choice: ConflictChoice | null) => void;
}

interface PromptState {
  conflict: ConflictPrompt | null;
  quota: (QuotaDetails & { fileCount: number }) | null;
  /** "Apply to all": the choice reused by later batches and uploads in this session. */
  remembered: ConflictChoice | null;
}

export const useUploadPrompts = create<PromptState>()(() => ({ conflict: null, quota: null, remembered: null }));

/** Resolves with the person's choice, or null when they cancel the upload. */
export function askConflict(paths: string[]): Promise<ConflictChoice | null> {
  const remembered = useUploadPrompts.getState().remembered;
  if (remembered) return Promise.resolve(remembered);
  return new Promise((resolve) => {
    const prev = useUploadPrompts.getState().conflict;
    prev?.resolve(null);
    useUploadPrompts.setState({ conflict: { paths, resolve } });
  });
}

export function answerConflict(choice: ConflictChoice | null, applyToAll = false): void {
  const cur = useUploadPrompts.getState().conflict;
  useUploadPrompts.setState({ conflict: null, ...(choice && applyToAll ? { remembered: choice } : {}) });
  cur?.resolve(choice);
}

export function showQuota(d: QuotaDetails, fileCount: number): void {
  useUploadPrompts.setState({ quota: { ...d, fileCount } });
}

export function closeQuota(): void {
  useUploadPrompts.setState({ quota: null });
}
