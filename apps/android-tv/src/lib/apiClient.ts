import { API_BASE_URL, REQUEST_TIMEOUT } from "../constants/api";

type FetchJsonOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: Record<string, string>;
  body?: string;
};

function serializeError(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function withTimeout<T>(
  promise: Promise<T>,
  ms = REQUEST_TIMEOUT,
  label = "REQUEST",
): Promise<T> {
  return new Promise((resolve, reject) => {
    let done = false;

    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      reject(new Error(`${label}_TIMEOUT`));
    }, ms);

    promise
      .then((value) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        reject(error);
      });
  });
}

export async function fetchJson<T = unknown>(
  path: string,
  token?: string | null,
  options?: FetchJsonOptions,
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options?.headers || {}),
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await withTimeout(
    fetch(`${API_BASE_URL}${path}`, {
      method: options?.method || "GET",
      headers,
      body: options?.body,
    }),
    REQUEST_TIMEOUT,
    `FETCH_${path}`,
  );

  const text = await res.text();

  let data: unknown = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!res.ok) {
    console.log("[API] HTTP error:", {
      path,
      status: res.status,
      responseText: typeof text === "string" ? text.slice(0, 500) : "",
    });

    throw new Error(`HTTP_${res.status}`);
  }

  return data as T;
}

export function toApiErrorMessage(error: unknown) {
  return serializeError(error);
}