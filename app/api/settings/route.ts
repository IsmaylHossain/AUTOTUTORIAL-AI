import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { saveSettings, settings } from "../../../lib/store";

export const runtime = "nodejs";

function configured() {
  return {
    groqConfigured: !!process.env.GROQ_API_KEY?.trim(),
    geminiConfigured: !!process.env.GEMINI_API_KEY?.trim(),
  };
}

function saveApiKey(name: "GROQ_API_KEY" | "GEMINI_API_KEY", raw: unknown) {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) return;
  if (/[\r\n]/.test(value)) throw new Error(`${name} contains invalid characters.`);
  const file = path.join(process.cwd(), ".env.local");
  let text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const expression = new RegExp(`^${name}=.*$`, "m");
  const line = `${name}=${value}`;
  text = expression.test(text)
    ? text.replace(expression, line)
    : `${text.trimEnd()}\n${line}\n`;
  fs.writeFileSync(file, text);
  process.env[name] = value;
}

export async function GET() {
  return NextResponse.json({ ...settings(), ...configured() });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    saveApiKey("GROQ_API_KEY", body.groqApiKey);
    saveApiKey("GEMINI_API_KEY", body.geminiApiKey);
    if (body.apiKey) {
      saveApiKey(
        body.provider === "gemini" ? "GEMINI_API_KEY" : "GROQ_API_KEY",
        body.apiKey,
      );
    }
    const saved = saveSettings({
      ...body,
      apiKey: undefined,
      groqApiKey: undefined,
      geminiApiKey: undefined,
    });
    return NextResponse.json({ ok: true, settings: saved, ...configured() });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error.message || "Could not save settings." },
      { status: 500 },
    );
  }
}
