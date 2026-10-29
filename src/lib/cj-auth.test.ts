// @ts-nocheck -- run with `bun test`
import { describe, expect, test } from "bun:test";
import { isLikelyCjAccessToken, parseCjSession } from "./cj-auth.server";
import cjAuth from "./ebay/__fixtures__/cj-auth.json";
import { isCjTokenError, CjTokenExpiredError } from "./cj.server";

describe("CJ API-key-only auth", () => {
  test("parses a CJ session fixture", () => {
    const session = parseCjSession(cjAuth);
    expect(session.access_token).toBe("cj-test-access-token");
    expect(session.expires_at).toBeGreaterThan(Date.now());
  });
  test("JWT-shaped value is flagged as an access token, a plain key is not", () => {
    expect(isLikelyCjAccessToken("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefgh12345678")).toBe(
      true,
    );
    expect(isLikelyCjAccessToken("a1b2c3d4e5f6g7h8i9j0k1l2m3n4")).toBe(false);
    expect(isLikelyCjAccessToken("")).toBe(false);
  });
  test("CJ 1600001 is a token error, not a generic failure", () => {
    expect(isCjTokenError(new CjTokenExpiredError())).toBe(true);
    expect(isCjTokenError(new Error("CJ request failed (500)"))).toBe(false);
  });
});
