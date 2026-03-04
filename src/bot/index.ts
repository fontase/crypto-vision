/**
 * Sect Bot — Main Entry Point
 *
 * Initializes and starts the Telegram bot, background workers,
 * and registers webhook or long-polling mode.
 *
 * @copyright 2024-2026 nirholas. All rights reserved.
 */

import { createBot } from "./telegram/bot.js";
import { startPriceTracker, stopPriceTracker, setAlertDeliveryCallback } from "./workers/price-tracker.js";
import { startHardcoreWorker, stopHardcoreWorker, setKickCallback } from "./workers/hardcore-worker.js";
import { logger } from "@/lib/logger";
import { closeDb } from "./db/index.js";
import type { Bot } from "grammy";
import { formatInsiderAlert } from "./messages/formatter.js";
import { getUserById } from "./services/user-service.js";
import { getGroupById } from "./services/group-service.js";

const log = logger.child({ module: "sectbot" });

let botInstance: Bot | null = null;

/**
 * Start the Sect Bot — connects to Telegram, starts workers.
 */
export async function startBot(): Promise<Bot> {
  const token = process.env["TELEGRAM_BOT_TOKEN"];
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN environment variable is required");
  }

  log.info("Starting Sect Bot...");

  const bot = createBot(token);
  botInstance = bot;

  // Set up worker callbacks that need access to the bot instance

  // Insider alert delivery — send DM to each subscriber
  setAlertDeliveryCallback(async (subscriberTelegramIds, call, alertData) => {
    try {
      // Look up caller username from call.userId
      const caller = await getUserById(call.userId);
      const callerUsername = caller?.username ?? null;

      const msg = formatInsiderAlert(
        call,
        callerUsername,
        alertData.callerWinRate,
        alertData.callerAvgGain,
        alertData.callerTotalCalls,
      );

      for (const telegramId of subscriberTelegramIds) {
        try {
          await bot.api.sendMessage(telegramId, msg, { parse_mode: "HTML" });
        } catch (sendErr) {
          log.warn({ err: sendErr, telegramId }, "Failed to deliver insider alert to subscriber");
        }
      }
    } catch (err) {
      log.warn({ err }, "Failed to prepare insider alert message");
    }
  });

  // Hardcore kick callback — ban removed users from group
  setKickCallback(async (groupId: string, removedUsers: Array<{ userId: string; username: string | null; winRate: number }>) => {
    try {
      // Resolve internal group ID → Telegram group ID
      const group = await getGroupById(groupId);
      if (!group) {
        log.warn({ groupId }, "Cannot kick users: group not found");
        return;
      }
      const chatId = parseInt(group.telegramId);

      for (const user of removedUsers) {
        try {
          // Look up user's Telegram ID
          const dbUser = await getUserById(user.userId);
          if (!dbUser) continue;

          const userTelegramId = parseInt(dbUser.telegramId);
          await bot.api.banChatMember(chatId, userTelegramId);
          // Immediately unban to allow rejoin (but they've been removed)
          await bot.api.unbanChatMember(chatId, userTelegramId);

          log.info(
            { groupId, userId: user.userId, username: user.username, winRate: user.winRate },
            "Hardcore kick executed",
          );
        } catch (kickErr) {
          log.warn({ err: kickErr, groupId, userId: user.userId }, "Failed to kick user in hardcore mode");
        }
      }
    } catch (err) {
      log.warn({ err, groupId }, "Failed to process hardcore kicks");
    }
  });

  // Start background workers
  startPriceTracker();
  startHardcoreWorker();

  // Set bot commands menu
  await bot.api.setMyCommands([
    { command: "start", description: "Get started with Sect Bot" },
    { command: "leaderboard", description: "View group leaderboards" },
    { command: "last", description: "Show recent calls" },
    { command: "pnl", description: "Generate PNL card" },
    { command: "gpnl", description: "Group PNL card" },
    { command: "calls", description: "View user calls" },
    { command: "alpha", description: "Alpha calls" },
    { command: "gamble", description: "Gamble calls" },
    { command: "winrate", description: "Check win rate" },
    { command: "hardcore", description: "Hardcore mode stats" },
    { command: "rank", description: "Your rank card (DM)" },
    { command: "ref", description: "Referral link (DM)" },
    { command: "payments", description: "Purchase premium (DM)" },
    { command: "settings", description: "Group settings (admin)" },
    { command: "language", description: "Set language (admin)" },
    { command: "premium", description: "Premium status" },
    { command: "channel", description: "Call channels (admin)" },
    { command: "wipeleaderboard", description: "Reset leaderboard (admin)" },
    { command: "block", description: "Block user (admin)" },
    { command: "unblock", description: "Unblock user (admin)" },
    { command: "ads", description: "Custom ads (premium)" },
    { command: "reset", description: "Reset settings (admin)" },
  ]);

  // Start long polling
  bot.start({
    onStart: (botInfo) => {
      log.info({ username: botInfo.username }, "Sect Bot started");
    },
    allowed_updates: [
      "message",
      "callback_query",
      "chat_member",
      "my_chat_member",
    ],
  });

  return bot;
}

/**
 * Stop the bot gracefully.
 */
export async function stopBot(): Promise<void> {
  log.info("Stopping Sect Bot...");

  stopPriceTracker();
  stopHardcoreWorker();

  if (botInstance) {
    await botInstance.stop();
    botInstance = null;
  }

  await closeDb();
  log.info("Sect Bot stopped");
}

/**
 * Get the running bot instance.
 */
export function getBotInstance(): Bot | null {
  return botInstance;
}
