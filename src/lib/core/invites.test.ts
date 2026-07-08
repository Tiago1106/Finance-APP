import { describe, expect, it } from "vitest";
import {
  generateInviteCode,
  INVITE_VALIDITY_HOURS,
  inviteExpiresAt,
  validateInvite,
} from "./invites";

function unwrap<T, E>(r: { ok: true; data: T } | { ok: false; error: E }): T {
  if (!r.ok) throw new Error("esperava ok: " + JSON.stringify(r.error));
  return r.data;
}

describe("generateInviteCode", () => {
  it("gera 8 chars do alfabeto sem ambiguos, deterministico nos bytes", () => {
    const code = unwrap(generateInviteCode(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7])));
    expect(code).toHaveLength(8);
    expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
    // sem 0, O, 1, I, L
    expect(code).not.toMatch(/[01OIL]/);
  });

  it("rejeita entropia insuficiente", () => {
    expect(generateInviteCode(new Uint8Array(4)).ok).toBe(false);
  });
});

describe("inviteExpiresAt", () => {
  it("expira 48h depois", () => {
    const now = new Date("2026-07-06T12:00:00Z");
    const expires = inviteExpiresAt(now);
    expect(expires.getTime() - now.getTime()).toBe(INVITE_VALIDITY_HOURS * 3600 * 1000);
  });
});

describe("validateInvite", () => {
  const now = new Date("2026-07-06T12:00:00Z");

  it("valido: nao usado e nao expirado", () => {
    const r = validateInvite(
      { expiresAt: new Date("2026-07-07T12:00:00Z"), usedAt: null },
      now
    );
    expect(r.ok).toBe(true);
  });

  it("ja usado", () => {
    const r = validateInvite(
      { expiresAt: new Date("2026-07-07T12:00:00Z"), usedAt: new Date("2026-07-06T10:00:00Z") },
      now
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("invite/already_used");
  });

  it("expirado (inclusive no instante exato)", () => {
    const r = validateInvite({ expiresAt: now, usedAt: null }, now);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("invite/expired");
  });
});
