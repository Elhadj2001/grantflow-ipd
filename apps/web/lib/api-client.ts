/**
 * Client HTTP minimal pour l'API NestJS (apps/api).
 *
 * Préfère `fetch` natif pour profiter du dedup Next.js et de la
 * compatibilité Server Components + édition future via PWA/SW.
 * `axios` reste dispo si besoin d'interceptors complexes.
 *
 * Spécificités sprint F1 :
 *  - injecte `Authorization: Bearer {accessToken}` (passé en arg
 *    par le hook useApi() qui le récupère via useSession()).
 *  - lève `ApiError` typée pour 4xx/5xx — le hook useApi map ces
 *    erreurs sur des actions (toast / signOut).
 */
export interface ApiErrorBody {
  code?: string;
  message?: string;
  details?: Record<string, unknown>;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: ApiErrorBody,
  ) {
    super(body.message ?? `HTTP ${status}`);
    this.name = 'ApiError';
  }
}

export interface ApiFetchOptions extends Omit<RequestInit, 'body'> {
  accessToken?: string | null;
  /** Body JSON-encodé automatiquement si fourni (Content-Type ajouté). */
  json?: unknown;
}

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

export async function apiFetch<T = unknown>(
  path: string,
  options: ApiFetchOptions = {},
): Promise<T> {
  const { accessToken, json, headers, ...rest } = options;
  const url = path.startsWith('http')
    ? path
    : `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;

  const finalHeaders = new Headers(headers);
  if (accessToken) finalHeaders.set('Authorization', `Bearer ${accessToken}`);
  let body: BodyInit | undefined;
  if (json !== undefined) {
    finalHeaders.set('Content-Type', 'application/json');
    body = JSON.stringify(json);
  }

  const res = await fetch(url, { ...rest, headers: finalHeaders, body });

  // 204 No Content
  if (res.status === 204) return undefined as T;

  const contentType = res.headers.get('content-type') ?? '';
  const isJson = contentType.includes('application/json');
  const payload = isJson ? await res.json().catch(() => ({})) : await res.text();

  if (!res.ok) {
    const errBody: ApiErrorBody = isJson
      ? (payload as ApiErrorBody)
      : { message: typeof payload === 'string' ? payload : undefined };
    throw new ApiError(res.status, errBody);
  }

  return payload as T;
}
