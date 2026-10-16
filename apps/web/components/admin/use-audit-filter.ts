'use client';

import { useCallback, useEffect, useState } from 'react';
import { auditFilterSearch, EMPTY_AUDIT, parseAuditFilter, type AuditFilter } from './admin-route';

/** The audit filters in the URL, and a way to change them (replaces the history entry). */
export function useAuditFilterRoute(): [AuditFilter, (next: AuditFilter) => void] {
  const [filter, setFilter] = useState<AuditFilter>(() =>
    typeof window === 'undefined' ? EMPTY_AUDIT : parseAuditFilter(window.location.search),
  );
  useEffect(() => {
    const onPop = () => setFilter(parseAuditFilter(window.location.search));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const go = useCallback((next: AuditFilter) => {
    const p = new URLSearchParams(window.location.search);
    for (const k of ['q', 'userId', 'kind', 'workspaceId', 'range']) p.delete(k);
    for (const [k, v] of new URLSearchParams(auditFilterSearch(next))) p.append(k, v);
    const s = p.toString();
    const url = `${window.location.pathname}${s ? `?${s}` : ''}`;
    if (url !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(window.history.state, '', url);
    setFilter(next);
  }, []);
  return [filter, go];
}
