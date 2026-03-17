import {
  Client,
  GatewayIntentBits,
  AttachmentBuilder,
  Events,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  TextChannel,
} from "discord.js";
import axios from "axios";
import { readFileSync, writeFileSync } from "fs";

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

const PERSISTENT_MSG_FILE = "./persistent_msg_id.txt";

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

function buildButtonRow(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("preset_film")
      .setLabel("🎬 Film")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("preset_ad")
      .setLabel("🎙️ Ad")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("preset_reel")
      .setLabel("📱 Reel")
      .setStyle(ButtonStyle.Secondary)
  );
}

async function sendPersistentButtons(channel: TextChannel): Promise<void> {
  // Delete the previous persistent message if we have its ID
  try {
    const oldId = readFileSync(PERSISTENT_MSG_FILE, "utf-8").trim();
    if (oldId) {
      const oldMsg = await channel.messages.fetch(oldId).catch(() => null);
      if (oldMsg) await oldMsg.delete().catch(() => {});
    }
  } catch {
    // File doesn't exist yet — first run
  }

  const msg = await channel.send({
    content:
      "**🎤 Text-to-Speech** — Pick a style and enter your text:",
    components: [buildButtonRow()],
  });

  writeFileSync(PERSISTENT_MSG_FILE, msg.id);
  console.log(`📌 Persistent button message sent (ID: ${msg.id})`);
}

async function generateAudio(
  text: string,
  preset: StylePreset
): Promise<Buffer> {
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
  return Buffer.from(response.data);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`✅ Logged in as ${readyClient.user.tag}`);
  console.log(`🎙️  Listening in channel: ${DISCORD_CHANNEL_ID}`);
  console.log(`🔊 Using ElevenLabs voice: ${ELEVENLABS_VOICE_ID}`);

  try {
    const channel = await readyClient.channels.fetch(DISCORD_CHANNEL_ID);
    if (channel instanceof TextChannel) {
      await sendPersistentButtons(channel);
    } else {
      console.warn("⚠️  DISCORD_CHANNEL_ID is not a text channel — buttons not sent.");
    }
  } catch (err) {
    console.error("❌ Failed to send persistent buttons:", err);
  }
});

// Button click → show modal
client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isButton()) {
    const presetKey = interaction.customId.replace("preset_", "");
    const preset = PRESETS[presetKey];
    if (!preset) return;

    const modal = new ModalBuilder()
      .setCustomId(`modal_${presetKey}`)
      .setTitle(`${preset.label} — Enter your text`);

    const textInput = new TextInputBuilder()
      .setCustomId("tts_text")
      .setLabel("Text to convert to speech")
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder("Type your text here…")
      .setMaxLength(2500)
      .setRequired(true);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(textInput)
    );

    await interaction.showModal(modal);
    return;
  }

  // Modal submit → generate audio and reply
  if (interaction.isModalSubmit()) {
    const presetKey = interaction.customId.replace("modal_", "");
    const preset = PRESETS[presetKey];
    if (!preset) return;

    const text = interaction.fields.getTextInputValue("tts_text").trim();

    if (!text) {
      await interaction.reply({ content: "⚠️ No text provided.", ephemeral: true });
      return;
    }

    await interaction.deferReply();

    console.log(
      `📝 [${preset.label}] Converting: "${text.slice(0, 80)}${text.length > 80 ? "…" : ""}"`
    );

    try {
      const audioBuffer = await generateAudio(text, preset);
      const attachment = new AttachmentBuilder(audioBuffer, {
        name: "speech.mp3",
        description: `TTS for: ${text.slice(0, 100)}`,
      });

      await interaction.editReply({
        content: preset.label,
        files: [attachment],
      });

      console.log(
        `✅ Audio sent (${(audioBuffer.length / 1024).toFixed(1)} KB) — style: ${preset.label}`
      );

      // Re-send the button panel at the bottom of the channel
      const channel = interaction.channel;
      if (channel instanceof TextChannel) {
        await sendPersistentButtons(channel);
      }
    } catch (err) {
      console.error("❌ ElevenLabs API error:", err);

      let errorMsg =
        "❌ An unexpected error occurred while generating speech.";

      if (axios.isAxiosError(err)) {
        const status = err.response?.status;
        if (status === 401) {
          errorMsg =
            "❌ ElevenLabs authentication failed. Please check your API key.";
        } else if (status === 429) {
          errorMsg =
            "⚠️ ElevenLabs rate limit reached. Please try again in a moment.";
        } else {
          errorMsg = `❌ Failed to generate speech (API error ${status ?? "unknown"}). Please try again.`;
        }
      }

      await interaction.editReply({ content: errorMsg });
    }
    return;
  }
});

// Keep tag-based text messages working as well
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  if (message.channelId !== DISCORD_CHANNEL_ID) return;

  const raw = message.content.trim();
  if (!raw) return;

  const { preset, text } = parseMessage(raw);
  if (!text) return;

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
    const audioBuffer = await generateAudio(text, preset);
    const attachment = new AttachmentBuilder(audioBuffer, {
      name: "speech.mp3",
      description: `TTS for: ${text.slice(0, 100)}`,
    });

    await message.reply({ content: preset.label, files: [attachment] });
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
