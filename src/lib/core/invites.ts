import { err, ok, type Result } from "./result";

export const INVITE_VALIDITY_HOURS = 48;

/**
 * Alfabeto sem caracteres ambiguos (0/O, 1/I/L) — codigo sera digitado
 * manualmente pela pessoa convidada.
 */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;

/**
 * Gera o codigo de convite a partir de bytes aleatorios fornecidos pelo
 * chamador (core puro: nao acessa crypto diretamente).
 */
export function generateInviteCode(randomBytes: Uint8Array): Result<string> {
  if (randomBytes.length < CODE_LENGTH) {
    return err({
      code: "invite/insufficient_entropy",
      message: `Sao necessarios ao menos ${CODE_LENGTH} bytes aleatorios.`,
    });
  }
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[randomBytes[i] % CODE_ALPHABET.length];
  }
  return ok(code);
}

export function inviteExpiresAt(now: Date): Date {
  return new Date(now.getTime() + INVITE_VALIDITY_HOURS * 60 * 60 * 1000);
}

export type InviteForValidation = {
  expiresAt: Date;
  usedAt: Date | null;
};

export type InviteRejection = {
  code: "invite/already_used" | "invite/expired";
  message: string;
};

/**
 * Valida se um convite pode ser aceito. Convite inexistente e tratado
 * pelo chamador (lookup no banco) — aqui validamos apenas o estado.
 */
export function validateInvite(
  invite: InviteForValidation,
  now: Date
): Result<true, InviteRejection> {
  if (invite.usedAt !== null) {
    return err({
      code: "invite/already_used",
      message: "Este convite ja foi utilizado.",
    });
  }
  if (invite.expiresAt.getTime() <= now.getTime()) {
    return err({
      code: "invite/expired",
      message: "Este convite expirou. Peca um novo codigo.",
    });
  }
  return ok(true);
}
