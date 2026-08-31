export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

let tokenGetter: () => string | undefined = () => undefined;

/** Set once by AuthedApp so hooks need not thread the token through. */
export function setTokenGetter(fn: () => string | undefined): void {
  tokenGetter = fn;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const token = tokenGetter();
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  if (!res.ok) {
    let message = text;
    try {
      message = (JSON.parse(text) as { error?: string }).error ?? text;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, message || res.statusText);
  }
  return text ? (JSON.parse(text) as T) : ({} as T);
}

/**
 * Fetches with the bearer token and saves the response as a file.
 *
 * A plain <a href> cannot be used: browser navigation sends no Authorization
 * header and the API gateway authorizer returns 401.
 */
async function download(path: string, filename: string): Promise<void> {
  const token = tokenGetter();
  const res = await fetch(`/api${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    throw new ApiError(res.status, (await res.text()) || res.statusText);
  }

  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const api = {
  download,
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
  del: <T>(path: string) => request<T>("DELETE", path),
};
