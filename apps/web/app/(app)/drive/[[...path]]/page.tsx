'use client';

// /drive/[[...path]] (architecture §10.1): the file browser for the folder in
// the URL. The store's `path` mirrors the URL.
import { useEffect } from 'react';
import FileBrowser from '@/components/drive/file-browser';
import { useDrivePath } from '@/lib/nav';
import { useVx } from '@/lib/store';

export default function DrivePage() {
  const path = useDrivePath();
  const setPath = useVx((s) => s.setPath);
  useEffect(() => setPath(path), [path, setPath]);
  return <FileBrowser path={path} />;
}
