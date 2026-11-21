/**
 * Centralized API Client for MIRAI Backend.
 *
 * Configured via VITE_API_BASE_URL.
 * Automatically attaches Firebase ID tokens for authenticated per-user isolation.
 * Supports typed JSON calls, multipart ZIP uploads, and binary ZIP archive downloads.
 */

import { auth } from '../lib/firebase';
import { ApiError } from '../types/api';

const rawApiBase = (import.meta.env.VITE_API_BASE_URL || '').trim().replace(/\/$/, '');
const API_BASE_URL = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(rawApiBase) ? '' : rawApiBase;

async function buildAuthHeaders(existing?: HeadersInit, forceRefresh = false): Promise<Headers> {
  const headers = new Headers(existing || {});
  if (!headers.has('Authorization') && auth.currentUser) {
    try {
      const token = await auth.currentUser.getIdToken(forceRefresh);
      if (token) {
        headers.set('Authorization', `Bearer ${token}`);
      }
    } catch {
      // Proceed without token; server will respond with 401 if required.
    }
  }
  return headers;
}

async function fetchWithAuthRetry(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const headers = await buildAuthHeaders(options.headers, false);
  let response = await fetch(url, {
    credentials: 'include',
    ...options,
    headers,
  });

  if (response.status === 401 && auth.currentUser && !new Headers(options.headers || {}).has('Authorization')) {
    const refreshedHeaders = await buildAuthHeaders(options.headers, true);
    response = await fetch(url, {
      credentials: 'include',
      ...options,
      headers: refreshedHeaders,
    });
  }

  return response;
}

async function parseResponseError(response: Response): Promise<ApiError> {
  if (response.status === 401) window.dispatchEvent(new Event('ctf:unauthorized'));
  let detailMessage = `Request failed with status ${response.status}`;
  let detailData: unknown = undefined;

  try {
    const data = await response.json();
    detailData = data;
    if (data && typeof data === 'object') {
      if (typeof data.detail === 'string') {
        detailMessage = data.detail;
      } else if (Array.isArray(data.detail)) {
        detailMessage = data.detail
          .map((err: { msg?: string; loc?: string[] }) => err.msg || 'Validation error')
          .join(', ');
      } else if (typeof data.message === 'string') {
        detailMessage = data.message;
      }
    }
  } catch {
    try {
      const text = (await response.text()).trim();
      if (text) {
        if (/^<!doctype\s+html|^<html[\s>]/i.test(text)) {
          detailMessage = `Server returned HTTP ${response.status}. Please retry in a moment.`;
        } else {
          detailMessage = text.slice(0, 400);
        }
      }
    } catch {
      // Keep default
    }
  }

  return {
    message: detailMessage,
    statusCode: response.status,
    detail:
      typeof detailData === 'object' && detailData !== null
        ? (detailData as Record<string, unknown>)
        : detailMessage,
  };
}

export async function requestJson<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;
  const headers = new Headers(options.headers || {});

  if (options.body && !headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  try {
    const response = await fetchWithAuthRetry(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const error = await parseResponseError(response);
      throw error;
    }

    return (await response.json()) as T;
  } catch (err: unknown) {
    if ((err as ApiError)?.message) {
      throw err;
    }
    throw {
      message: (err as Error)?.message || 'Network request failed or server is unreachable.',
      statusCode: 0,
    } as ApiError;
  }
}

export async function requestMultipart<T>(
  endpoint: string,
  formData: FormData,
  signal?: AbortSignal
): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;

  try {
    const response = await fetchWithAuthRetry(url, {
      method: 'POST',
      body: formData,
      signal,
    });

    if (!response.ok) {
      const error = await parseResponseError(response);
      throw error;
    }

    return (await response.json()) as T;
  } catch (err: unknown) {
    if ((err as ApiError)?.message) {
      throw err;
    }
    throw {
      message: (err as Error)?.message || 'File upload failed.',
      statusCode: 0,
    } as ApiError;
  }
}

export interface DownloadResult {
  blob: Blob;
  filename: string;
  harborTaskName?: string;
  validationStatus?: string;
}

export async function requestBlob(
  endpoint: string,
  options: RequestInit = {}
): Promise<DownloadResult> {
  const url = `${API_BASE_URL}${endpoint}`;
  const headers = new Headers(options.headers || {});

  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  try {
    const response = await fetchWithAuthRetry(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const error = await parseResponseError(response);
      throw error;
    }

    const blob = await response.blob();
    const disposition = response.headers.get('content-disposition') || '';
    let filename = 'task-package.zip';

    const match = disposition.match(/filename="?([^";]+)"?/i);
    if (match && match[1]) {
      filename = match[1].trim();
    }

    return {
      blob,
      filename,
      harborTaskName: response.headers.get('x-harbor-task-name') || undefined,
      validationStatus: response.headers.get('x-validation-status') || undefined,
    };
  } catch (err: unknown) {
    if ((err as ApiError)?.message) {
      throw err;
    }
    throw {
      message: (err as Error)?.message || 'Download failed.',
      statusCode: 0,
    } as ApiError;
  }
}

export async function requestText(endpoint: string, signal?: AbortSignal): Promise<string> {
  const response = await fetchWithAuthRetry(API_BASE_URL + endpoint, { signal });
  if (!response.ok) throw await parseResponseError(response);
  return response.text();
}
