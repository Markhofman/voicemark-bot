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
});

client.on(Events.MessageCreate, async (message) => {
  // Ignore bots (including self)
  if (message.author.bot) return;

  // Only process messages in the configured channel
  if (message.channelId !== DISCORD_CHANNEL_ID) return;

  const text = message.content.trim();

  // Skip empty messages
  if (!text) return;

  // Guard against excessively long messages
  if (text.length > 2500) {
    await message.reply(
      "⚠️ That message is too long (max 2500 characters). Please split it into smaller parts."
    );
    return;
  }

  console.log(
    `📝 Converting to speech: "${text.slice(0, 80)}${text.length > 80 ? "…" : ""}"`
  );

  // Show typing indicator while generating
  await message.channel.sendTyping();

  try {
    const response = await axios.post<ArrayBuffer>(
      `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`,
      {
        text,
        model_id: "eleven_monolingual_v1",
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
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

    await message.reply({ files: [attachment] });
    console.log(`✅ Audio sent (${(audioBuffer.length / 1024).toFixed(1)} KB)`);
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
