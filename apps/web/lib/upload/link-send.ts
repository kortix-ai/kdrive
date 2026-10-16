// Sends one file through an upload link: the raw bytes in one request, with
// progress (fetch has no upload progress, so this is an XMLHttpRequest).
import { PublicUploadResponse } from '@volumes/shared';
import { ApiError, qs } from '@/lib/api/client';

export function linkUploadUrl(token: string, relPath: string, sender: string | null): string {
  return `/api/public/u/${encodeURIComponent(token)}/files${qs({ name: relPath, sender })}`;
}

/** Resolves with what was received; rejects with an ApiError (status 0 when the network failed). */
export function sendFile(
  token: string,
  file: Blob,
  relPath: string,
  sender: string | null,
  onProgress: (sent: number) => void,
  signal?: AbortSignal,
): Promise<PublicUploadResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', linkUploadUrl(token, relPath, sender));
    xhr.setRequestHeader('content-type', 'application/octet-stream');
    xhr.setRequestHeader('accept', 'application/json');
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onerror = () => reject(new ApiError(0, 'upstream_unavailable', 'Could not reach the server. Check your connection.'));
    xhr.onabort = () => reject(new DOMException('Aborted', 'AbortError'));
    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        body = null;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        const ok = PublicUploadResponse.safeParse(body);
        if (ok.success) return resolve(ok.data);
        return reject(new ApiError(xhr.status, 'internal', 'Unexpected answer from the server.'));
      }
      const err = (body as { error?: { code?: string; message?: string; details?: Record<string, unknown> } } | null)?.error;
      const retry = Number(xhr.getResponseHeader('retry-after'));
      reject(
        new ApiError(
          xhr.status,
          err?.code ?? 'internal',
          err?.message ?? 'The file could not be sent.',
          err?.details ?? {},
          Number.isFinite(retry) && retry > 0 ? retry : null,
        ),
      );
    };
    signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(file);
  });
}
