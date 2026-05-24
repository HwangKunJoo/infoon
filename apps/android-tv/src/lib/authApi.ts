import { fetchJson } from "./apiClient";

export type LoginResponse = any;

export function login(email: string, password: string) {
  return fetchJson<LoginResponse>("/digital_board/auth/login", null, {
    method: "POST",
    body: JSON.stringify({
      email,
      password,
    }),
  });
}