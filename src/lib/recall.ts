import axios, { AxiosInstance } from "axios";
import { getEnv, getRecallBaseUrl } from "./env";

// Silent MP3 - ~0.5s of silence, base64 encoded
// This is required to enable the Output Audio endpoint on Recall bots
const SILENT_MP3_B64 =
  "SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAABhgC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7//////////////////////////////////////////////////////////////////8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAAAAAAAAAABhkVHpRAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

function createRecallClient(): AxiosInstance {
  const env = getEnv();
  return axios.create({
    baseURL: getRecallBaseUrl(),
    headers: {
      Authorization: `Token ${env.RECALL_API_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    timeout: 30000,
  });
}

export interface CreateBotOptions {
  meetingUrl: string;
  botName?: string;
  webhookUrl: string;
  statusWebhookUrl?: string;
}

export interface RecallBot {
  id: string;
  meeting_url: string;
  bot_name: string;
  status_changes: Array<{
    code: string;
    message: string;
    created_at: string;
    sub_code: string;
  }>;
}

export async function createBot(options: CreateBotOptions): Promise<RecallBot> {
  const client = createRecallClient();
  const { meetingUrl, botName = "AI Interviewer", webhookUrl, statusWebhookUrl } = options;

  const payload: Record<string, unknown> = {
    meeting_url: meetingUrl,
    bot_name: botName,
    recording_config: {
      transcript: {
        provider: {
          recallai_streaming: {
            language_code: "auto",
            mode: "prioritize_accuracy",
          },
        },
        diarization: {
          use_separate_streams_when_available: true,
        },
      },
      realtime_endpoints: [
        {
          type: "webhook",
          url: webhookUrl,
          events: [
            "transcript.data",
            "participant_events.speech_on",
            "participant_events.speech_off",
            "participant_events.join",
            "participant_events.leave",
          ],
        },
      ],
    },
    automatic_audio_output: {
      in_call_recording: {
        data: {
          kind: "mp3",
          b64_data: SILENT_MP3_B64,
        },
      },
    },
    // Register status webhook so bot lifecycle events (in_call, done, fatal)
    // are delivered to /api/webhook/status — this triggers startInterview reliably.
    ...(statusWebhookUrl && {
      webhook: {
        url: statusWebhookUrl,
        events: [
          "bot.joining_call",
          "bot.in_call_not_recording",
          "bot.in_call_recording",
          "bot.done",
          "bot.fatal",
          "bot.call_ended",
        ],
      },
    }),
  };

  // Retry logic for 507 (temporary capacity unavailable)
  const MAX_RETRIES = 10;
  const RETRY_INTERVAL = 30000; // 30 seconds

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await client.post<RecallBot>("/bot/", payload);
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 507 && attempt < MAX_RETRIES) {
          console.log(
            `Bot creation returned 507, retrying in 30s (attempt ${attempt}/${MAX_RETRIES})`
          );
          await new Promise((resolve) => setTimeout(resolve, RETRY_INTERVAL));
          continue;
        }
        if (error.response?.status === 429) {
          const retryAfter = parseInt(
            error.response.headers["retry-after"] || "5",
            10
          );
          console.log(`Rate limited, waiting ${retryAfter}s`);
          await new Promise((resolve) =>
            setTimeout(resolve, retryAfter * 1000)
          );
          continue;
        }
      }
      throw error;
    }
  }

  throw new Error(
    "Ad-hoc bot capacity was unavailable after 10 retries. Consider using scheduled bots."
  );
}

export async function outputAudio(
  botId: string,
  audio: { kind: string; b64_data: string }
): Promise<void> {
  const client = createRecallClient();
  await client.post(`/bot/${botId}/output_audio/`, {
    kind: audio.kind,
    b64_data: audio.b64_data,
  });
}

export async function removeBot(botId: string): Promise<void> {
  const client = createRecallClient();
  await client.post(`/bot/${botId}/leave_call/`);
}

export async function getBot(botId: string): Promise<RecallBot> {
  const client = createRecallClient();
  const response = await client.get<RecallBot>(`/bot/${botId}/`);
  return response.data;
}
