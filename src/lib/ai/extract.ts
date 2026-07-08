import Anthropic from "@anthropic-ai/sdk";
import { err, ok, type Result } from "@/lib/core/result";
import { IntentSchema, intentJsonSchema, type Intent } from "./schema";
import { buildExtractionPrompt, type ExtractionContext } from "./prompt";

// Modelo fixado no CLAUDE.md secao 2 (extracao de JSON estruturado).
const EXTRACTION_MODEL = "claude-haiku-4-5";

export type ExtractionError = {
  code: "ai/api_error" | "ai/invalid_response";
  message: string;
};

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

/**
 * Extrai a intencao de uma mensagem do usuario via Claude Haiku com
 * structured outputs. Resposta que nao valide no schema Zod e REJEITADA
 * (Result de erro) — nunca corrigida silenciosamente (CLAUDE.md secao 4).
 */
export async function extractIntent(
  message: string,
  ctx: ExtractionContext
): Promise<Result<Intent, ExtractionError>> {
  let rawText: string;
  try {
    const response = await getClient().messages.create({
      model: EXTRACTION_MODEL,
      max_tokens: 1024,
      system: buildExtractionPrompt(ctx),
      output_config: {
        format: {
          type: "json_schema",
          schema: intentJsonSchema(),
        },
      },
      messages: [{ role: "user", content: message }],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return err({ code: "ai/invalid_response", message: "Resposta sem conteudo." });
    }
    rawText = textBlock.text;
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return err({ code: "ai/api_error", message: detail });
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawText);
  } catch {
    return err({ code: "ai/invalid_response", message: "Resposta nao e JSON valido." });
  }

  const validated = IntentSchema.safeParse(parsedJson);
  if (!validated.success) {
    return err({
      code: "ai/invalid_response",
      message: "JSON fora do schema: " + validated.error.issues[0]?.message,
    });
  }

  return ok(validated.data);
}
