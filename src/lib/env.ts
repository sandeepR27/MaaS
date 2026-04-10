import { z } from "zod";

const envSchema = z.object({
  RECALL_API_KEY: z.string().min(1),
  RECALL_REGION: z.string().default("us-west-2"),
  RECALL_WORKSPACE_VERIFICATION_SECRET: z.string().min(1),
  GEMINI_API_KEY: z.string().optional(),
  GROQ_API_KEY: z.string().min(1),
  TTS_PROVIDER: z.preprocess(
    (val) => {
      let str = "google";
      if (typeof val === "string") {
        str = val.trim() || "google";
      } else if (val != null) {
        str = String(val);
      }
      str = str.replace(/^['"]|['"]$/g, "").trim().toLowerCase();
      if (!["google", "elevenlabs", "gemini", "cartesia", "local"].includes(str)) {
        console.warn(`TTS_PROVIDER value '${val}' is not supported; falling back to 'google'`);
        str = "google";
      }
      return str;
    },
    z.string().default("google")
  ),
  GEMINI_TTS_MODEL: z.string().default("models/gemini-1.0"),
  GOOGLE_TTS_API_KEY: z.string().optional(),
  ELEVENLABS_API_KEY: z.string().optional(),
  ELEVENLABS_VOICE_ID: z.string().default("21m00Tcm4TlvDq8ikWAM"),
  CARTESIA_API_KEY: z.string().optional(),
  DEEPGRAM_API_KEY: z.string().optional(),
  DAILY_API_KEY: z.string().optional(),
  NEXT_PUBLIC_APP_URL: z.string().url(),
});

export type Env = z.infer<typeof envSchema>;

let _env: Env | null = null;

export function getEnv(): Env {
  if (_env) return _env;
  _env = envSchema.parse(process.env);
  return _env;
}

export function getRecallBaseUrl(): string {
  const env = getEnv();
  return `https://${env.RECALL_REGION}.recall.ai/api/v1`;
}
