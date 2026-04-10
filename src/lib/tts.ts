import { getEnv } from "./env";
import { spawnSync } from "child_process";
import { writeFileSync, readFileSync, unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

/**
 * Convert text to speech and return base64-encoded MP3.
 * Supports Google Cloud TTS (via REST API with API key), ElevenLabs, and Gemini.
 */
export interface SynthResult {
  b64_data: string;
  kind: "mp3" | "wav";
}

export async function synthesizeSpeech(text: string): Promise<SynthResult> {
  const env = getEnv();

  if (env.TTS_PROVIDER === "elevenlabs") {
    return synthesizeWithElevenLabs(text);
  } else if (env.TTS_PROVIDER === "google") {
    return synthesizeWithGoogleTTS(text);
  } else if (env.TTS_PROVIDER === "local") {
    return synthesizeWithLocalTTS(text);
  } else {
    // Default to gemini, with local fallback
    try {
      return await synthesizeWithGeminiTTS(text);
    } catch (e) {
      console.warn(`[TTS] Gemini TTS failed, falling back to local macOS TTS: ${e instanceof Error ? e.message : e}`);
      return synthesizeWithLocalTTS(text);
    }
  }
}

/**
 * Local TTS using macOS `say` command + ffmpeg.
 * Zero API calls, zero quotas, works completely offline.
 */
async function synthesizeWithLocalTTS(text: string): Promise<SynthResult> {
  const tempId = Math.random().toString(36).substring(7);
  const aiffPath = join(tmpdir(), `tts_${tempId}.aiff`);
  const mp3Path = join(tmpdir(), `tts_${tempId}.mp3`);

  try {
    // Step 1: Generate speech using macOS say command
    const sayResult = spawnSync("say", [
      "-o", aiffPath,
      "-r", "175",        // speaking rate (words per minute)
      "-v", "Samantha",   // high quality macOS voice
      text,
    ]);

    if (sayResult.status !== 0) {
      const error = sayResult.stderr?.toString() || "Unknown error";
      throw new Error(`macOS say command failed: ${error}`);
    }

    // Step 2: Convert AIFF to MP3 using ffmpeg
    const ffmpegResult = spawnSync("ffmpeg", [
      "-y",
      "-i", aiffPath,
      "-codec:a", "libmp3lame",
      "-b:a", "128k",
      "-ar", "44100",
      mp3Path,
    ]);

    if (ffmpegResult.status !== 0) {
      const error = ffmpegResult.stderr?.toString() || "Unknown ffmpeg error";
      throw new Error(`ffmpeg conversion failed: ${error}`);
    }

    const mp3Buffer = readFileSync(mp3Path);
    console.log(`[TTS] Local TTS generated ${mp3Buffer.length} bytes of MP3`);
    return {
      kind: "mp3",
      b64_data: mp3Buffer.toString("base64"),
    };
  } finally {
    try { unlinkSync(aiffPath); } catch (_e) {}
    try { unlinkSync(mp3Path); } catch (_e) {}
  }
}

async function synthesizeWithGeminiTTS(text: string): Promise<SynthResult> {
  const env = getEnv();
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is required for Gemini TTS");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = JSON.stringify({
    contents: [
      {
        role: "user",
        parts: [{ text: text }],
      },
    ],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            // Aoede, Puck, Charon, Kore, Fenrir, Leto
            voiceName: "Puck",
          },
        },
      },
    },
  });

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini TTS error ${response.status}: ${errText}`);
  }

  const data = await response.json();
  const part = data.candidates?.[0]?.content?.parts?.find((p: { inlineData?: { mimeType?: string } }) =>
    p.inlineData?.mimeType?.startsWith("audio/")
  );

  if (!part) {
    throw new Error("No audio content returned from Gemini 2.5 flash TTS");
  }

  // Gemini returns raw PCM at 24kHz, 16-bit signed little-endian, mono.
  // We must convert it to MP3 for Recall AI using ffmpeg.
  const pcmBase64 = part.inlineData.data;
  const pcmBuffer = Buffer.from(pcmBase64, "base64");

  // Create temporary files for the conversion
  const tempId = Math.random().toString(36).substring(7);
  const pcmPath = join(tmpdir(), `input_${tempId}.raw`);
  const mp3Path = join(tmpdir(), `output_${tempId}.mp3`);

  try {
    writeFileSync(pcmPath, pcmBuffer);

    // Use ffmpeg to convert raw PCM to MP3
    // -f s16le: raw 16-bit signed little-endian
    // -ar 24000: 24kHz sample rate
    // -ac 1: mono
    const ffmpeg = spawnSync("ffmpeg", [
      "-y",
      "-f", "s16le",
      "-ar", "24000",
      "-ac", "1",
      "-i", pcmPath,
      "-codec:a", "libmp3lame",
      "-b:a", "128k",
      mp3Path
    ]);

    if (ffmpeg.status !== 0) {
      const error = ffmpeg.stderr?.toString() || "Unknown ffmpeg error";
      throw new Error(`ffmpeg conversion failed: ${error}`);
    }

    const mp3Buffer = readFileSync(mp3Path);
    return {
      kind: "mp3",
      b64_data: mp3Buffer.toString("base64"),
    };
  } finally {
    // Cleanup temporary files
    try { unlinkSync(pcmPath); } catch (e) {}
    try { unlinkSync(mp3Path); } catch (e) {}
  }
}


async function synthesizeWithGoogleTTS(text: string): Promise<SynthResult> {
  const env = getEnv();
  const apiKey = env.GOOGLE_TTS_API_KEY || env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_TTS_API_KEY or GEMINI_API_KEY is required for Google TTS");

  const url = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(apiKey)}`;
  const body = JSON.stringify({
    input: { text },
    voice: {
      languageCode: "en-US",
      name: "en-US-Neural2-D",
      ssmlGender: "MALE",
    },
    audioConfig: {
      audioEncoding: "MP3",
      speakingRate: 1.0,
      pitch: 0,
    },
  });

  // Retry up to 2 times
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30000);

      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Google TTS error ${response.status}: ${errText}`);
      }

      const data = await response.json() as { audioContent: string };
      return { kind: "mp3", b64_data: data.audioContent };
    } catch (err) {
      console.error(`TTS attempt ${attempt + 1} failed:`, err instanceof Error ? err.message : err);
      if (attempt === 2) throw err;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  throw new Error("TTS failed after retries");
}

async function synthesizeWithElevenLabs(text: string): Promise<SynthResult> {
  const env = getEnv();
  const apiKey = env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY is required for ElevenLabs");

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${env.ELEVENLABS_VOICE_ID}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_turbo_v2_5",
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
        },
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`ElevenLabs error ${response.status}`);
  }

  const buf = Buffer.from(await response.arrayBuffer());
  return { kind: "mp3", b64_data: buf.toString("base64") };
}
