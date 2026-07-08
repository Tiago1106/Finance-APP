import { getBot } from "./bot";

/**
 * Notificacao proativa (cron da Fase 6: recorrencia lancada, lembrete de
 * conta a pagar). Falha de entrega nao derruba o cron — só loga.
 */
export async function notifyUser(telegramUserId: string, text: string): Promise<boolean> {
  try {
    await getBot().api.sendMessage(telegramUserId, text);
    return true;
  } catch (e) {
    console.error(`[bot] falha ao notificar ${telegramUserId}:`, e);
    return false;
  }
}
