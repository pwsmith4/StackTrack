import { describe, expect, it } from "vitest";
import { hashPassword } from "../src/admin-access.js";

describe("administrator password hashing", () => {
  it("uses a salted PBKDF2 representation instead of preserving the password", async () => {
    const encoded = await hashPassword("pilot-only-password", "deterministic-test-salt");
    expect(encoded).toMatch(/^pbkdf2-sha512\$210000\$deterministic-test-salt\$/);
    expect(encoded).not.toContain("pilot-only-password");
  });
});
