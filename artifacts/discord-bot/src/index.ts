import { Client, GatewayIntentBits, AttachmentBuilder, Events } from "discord.js";
import axios from "axios";

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
const ELEVENLABS_VOICE_ID =
  process.env.ELEVENLABS_VOICE_ID || "JBFqnCBsd6RMkjVDRZzb";

if (!DISCORD_BOT_TOKEN) throw new Error("DISCORD_BOT_TOKEN is required");
if (!ELEVENLABS_API_KEY) throw new Error("ELEVENLABS_API_KEY is required");
if (!DISCORD_CHANNEL_ID) throw new Error("DISCORD_CHANNEL_ID is required");

interface StylePreset {
  label: string;
  stability: number;
  similarity_boost: number;
  style: number;
  speed: number;
}

const PRESETS: Record<string, StylePreset> = {
  film: {
    label: "🎬 Film",
    stability: 0.75,
    similarity_boost: 0.85,
    style: 0.8,
    speed: 0.9,
  },
  ad: {
    label: "🎙️ Ad",
    stability: 0.45,
    similarity_boost: 0.8,
    style: 0.6,
    speed: 1.05,
  },
  reel: {
    label: "📱 Reel",
    stability: 0.3,
    similarity_boost: 0.85,
    style: 0.9,
    speed: 1.1,
  },
};

const DEFAULT_PRESET: StylePreset = {
  label: "🔊 Default",
  stability: 0.5,
  similarity_boost: 0.75,
  style: 0.0,
  speed: 1.0,
};

function parseMessage(raw: string): { preset: StylePreset; text: string } {
  const match = raw.match(/^\[(\w+)\]\s*/i);
  if (match) {
    const tag = match[1].toLowerCase();
    const preset = PRESETS[tag];
    if (preset) {
      return { preset, text: raw.slice(match[0].length).trim() };
    }
  }
  return { preset: DEFAULT_PRESET, text: raw };
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once(Events.ClientReady, (readyClient) => {
  console.log(`✅ Logged in as ${readyClient.user.tag}`);
  console.log(`🎙️  Listening for messages in channel: ${DISCORD_CHANNEL_ID}`);
  console.log(`🔊 Using ElevenLabs voice: ${ELEVENLABS_VOICE_ID}`);
  console.log(`🎨 Style presets available: [film] [ad] [reel]`);
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  if (message.channelId !== DISCORD_CHANNEL_ID) return;

  const raw = message.content.trim();
  if (!raw) return;

  const { preset, text } = parseMessage(raw);

  if (!text) {
    await message.reply("⚠️ No text found after the tag. Please include a message.");
    return;
  }

  if (text.length > 2500) {
    await message.reply(
      "⚠️ That message is too long (max 2500 characters). Please split it into smaller parts."
    );
    return;
  }

  console.log(
    `📝 [${preset.label}] Converting: "${text.slice(0, 80)}${text.length > 80 ? "…" : ""}"`
  );

  await message.channel.sendTyping();

  try {
    const response = await axios.post<ArrayBuffer>(
      `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`,
      {
        text,
        model_id: "eleven_multilingual_v2",
        voice_settings: {
          stability: preset.stability,
          similarity_boost: preset.similarity_boost,
          style: preset.style,
          speed: preset.speed,
        },
      },
      {
        headers: {
          "xi-api-key": ELEVENLABS_API_KEY,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        responseType: "arraybuffer",
      }
    );

    const audioBuffer = Buffer.from(response.data);
    const attachment = new AttachmentBuilder(audioBuffer, {
      name: "speech.mp3",
      description: `TTS for: ${text.slice(0, 100)}`,
    });

    await message.reply({
      content: preset.label,
      files: [attachment],
    });

    console.log(
      `✅ Audio sent (${(audioBuffer.length / 1024).toFixed(1)} KB) — style: ${preset.label}`
    );
  } catch (err) {
    console.error("❌ ElevenLabs API error:", err);

    if (axios.isAxiosError(err)) {
      const status = err.response?.status;
      if (status === 401) {
        await message.reply(
          "❌ ElevenLabs authentication failed. Please check your API key."
        );
      } else if (status === 429) {
        await message.reply(
          "⚠️ ElevenLabs rate limit reached. Please try again in a moment."
        );
      } else {
        await message.reply(
          `❌ Failed to generate speech (API error ${status ?? "unknown"}). Please try again.`
        );
      }
    } else {
      await message.reply(
        "❌ An unexpected error occurred while generating speech."
      );
    }
  }
});

client.login(DISCORD_BOT_TOKEN);
