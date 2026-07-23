import { Injectable } from "@danet/core";
import { bearerToken, type HttpRequest } from "../../common/http.ts";

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const value of bytes) {
    binary += String.fromCharCode(value);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

@Injectable()
export class AuthTokenService {
  generateOpaqueToken(): string {
    return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  }

  async hashToken(token: string): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
    return bytesToHex(new Uint8Array(digest));
  }

  extractBearerToken(request: HttpRequest): string | null {
    return bearerToken(request);
  }
}