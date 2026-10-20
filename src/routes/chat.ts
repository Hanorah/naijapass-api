import { Router } from "express";
import { z } from "zod";
import { config } from "../config";
import { query } from "../db/mysql";
import { HttpError } from "../middleware/error";
import { optionalAuth, type AuthedRequest } from "../middleware/auth";

export const chatRouter = Router();

function ragFallback(message: string, state: string): string {
  const q = message.toLowerCase();
  if (q.includes("emergency") || q.includes("police") || q.includes("ambulance")) {
    return `For emergencies in ${state}, dial 112 (national). Open Emergency in NaijaPass for state police, fire, and ambulance numbers.`;
  }
  if (q.includes("tender") || q.includes("procurement") || q.includes("contract")) {
    return `Open tenders for ${state} are listed under Procurement. Filter by sector and deadline, then bid from a verified business account.`;
  }
  if (q.includes("governor") || q.includes("who is")) {
    return `State leadership and MDA contacts for ${state} are in State Hub. Open State Hub for the governor, ministries, and key services.`;
  }
  if (q.includes("permit") || q.includes("license") || q.includes("business")) {
    return `Business permits and MDA contacts for ${state} are in State Hub. Verified companies can also list in the Directory and bid on open contracts.`;
  }
  return `You're viewing ${state}. Ask about emergencies, open tenders, permits, or who's in charge — or open State Hub / Procurement in NaijaPass.`;
}

chatRouter.post("/", optionalAuth, async (req: AuthedRequest, res, next) => {
  try {
    const body = z
      .object({
        message: z.string().min(1),
        state: z.string().optional(),
        history: z
          .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string() }))
          .optional(),
      })
      .parse(req.body);

    const message = body.message.trim();
    const state = body.state || "Lagos";

    // Pull a little live context from MySQL for better answers
    const [tenders, content] = await Promise.all([
      query<{ title: string; reference: string | null; deadline: string | null }>(
        `SELECT title, reference, deadline FROM tenders
         WHERE status = 'open' AND (state IS NULL OR state = :state)
         ORDER BY deadline IS NULL, deadline ASC LIMIT 5`,
        { state },
      ),
      query<{ title: string; type: string; phone: string | null }>(
        `SELECT title, type, phone FROM state_content
         WHERE published = 1 AND state = :state
         ORDER BY updated_at DESC LIMIT 8`,
        { state },
      ),
    ]);

    const contextBits = [
      ...tenders.map(
        (t) =>
          `Tender: ${t.title}${t.reference ? ` (${t.reference})` : ""}${t.deadline ? ` deadline ${t.deadline}` : ""}`,
      ),
      ...content.map(
        (c) => `${c.type}: ${c.title}${c.phone ? ` — ${c.phone}` : ""}`,
      ),
    ].join("\n");

    let reply = ragFallback(message, state);
    let source: "rag" | "gemini" = "rag";

    if (config.googleAiKey) {
      try {
        // Lightweight fetch to Gemini REST so we don't need the SDK package
        const prompt = `You are NaijaPass help desk. Plain text only, under 120 words.
User state: ${state}
Context:\n${contextBits || "(none)"}
User: ${message}`;

        const r = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${config.googleAiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
            }),
          },
        );
        if (r.ok) {
          const data = (await r.json()) as {
            candidates?: { content?: { parts?: { text?: string }[] } }[];
          };
          const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
          if (text) {
            reply = text;
            source = "gemini";
          }
        }
      } catch {
        // keep RAG fallback
      }
    }

    res.json({
      reply,
      configured: Boolean(config.googleAiKey),
      source,
      userId: req.user?.id ?? null,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      next(new HttpError(400, err.errors[0]?.message ?? "Invalid payload"));
      return;
    }
    next(err);
  }
});
