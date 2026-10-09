# Overnight Group

Discord bot for server announcements built with Discord.js v14 and Node.js LTS.

## Features

- `/thongbao` for authorized users to send announcements
- `/setting` for server administrators to define which roles may use the bot
- `/setting` also configures a per-server Discord log channel for announcement sender and destination records
- Discord lists registered global slash commands in the bot profile's **Lệnh** section
- Bot activity also shows `/thongbao` and `/setting`
- Safe JSON config stored in `data/guild-settings.json`
- Per-guild configuration, atomic file writes, and logging for announcement activity

## Prerequisites

- Node.js 20+
- A Discord application with a bot token
- Permission to add slash commands to your server

## Installation

1. Clone the project and open the folder.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Copy `.env.example` to `.env` and fill in the values:
   ```bash
   copy .env.example .env
   ```
4. Update `.env` with:
   - `BOT_TOKEN`: bot token from the Discord Developer Portal
   - `CLIENT_ID`: application ID for the bot
   - `GUILD_ID`: optional; if set, removes old server-only slash commands during deployment

## Commands

1. Deploy slash commands:
   ```bash
   npm run deploy
   ```
   or:
   ```bash
   npm run deploy:commands
   ```
   Commands are registered globally for use in servers, and deployment verifies Discord returns both command names. If `.env` contains an old `GUILD_ID`, deployment removes the guild-only copies to prevent them shadowing the global commands. Global command changes may take time to appear across Discord.
2. Start the bot:
   ```bash
   npm start
   ```

## Using `/thongbao`

1. Run `/thongbao` in a server where you are an administrator or have been allowed in `/setting`.
2. Start `/thongbao` by searching for the required `kenh` option, then optionally search `role1` through `role5` to add up to five mentions. Each role field uses Autocomplete independently and also suggests `@everyone` and `@here`; select at most one of these server-wide mentions. Those pings are sent only when the bot has **Mention Everyone** permission in the destination channel.
3. The compact modal contains the message editor and optional upload of up to four images. Insert emojis directly in the message using Discord's emoji picker; they stay inline with the text and are preserved when reopening the draft to edit. Discord Markdown is also preserved. All selected roles are mentioned at the end of the announcement. Manually entered `<@&ROLE_ID>` mentions are validated and moved to the end.
4. After submitting the modal, review the preview and choose **Gửi thông báo**, **Chỉnh sửa**, or **Hủy**. No public message is sent before choosing **Gửi thông báo**.

The message body is sent as normal Discord text when it fits Discord's 2000-character message limit. Longer bodies are sent in an embed description, with authorized role mentions posted separately after the announcement so they still appear at the bottom. Uploaded images are attached to the announcement. A user with `/thongbao` permission can target a private text channel even without access to view it; the bot must have **Send Messages** there, and also **Embed Links** for embed announcements. The user's channel visibility does not restrict the bot's destination. Role mentions work when the role is mentionable or the bot has the relevant permission in the destination channel. `@everyone` and `@here` are parsed only when the bot has the **Mention Everyone** permission there. `/thongbao` offers five independent role Autocomplete fields; `/setting` Autocomplete searches matching server roles and channels as you type. Any member with one allowed role is authorized. Administrators always retain access. Sessions are private, tied to the initiating user and server, and expire after 15 minutes.

Administrators manage settings with `/setting` Autocomplete subcommands:

- `/setting them-role role:<search>` grants a role permission to use `/thongbao`.
- `/setting go-role role:<search>` removes a role's permission.
- `/setting kenh-log kenh:<search>` chooses the announcement audit-log channel.
- `/setting xoa-log` disables Discord audit logging.
- `/setting xem` displays the current configuration.

After a successful announcement, the bot logs who sent it, the destination channel, and a link to the message. The bot needs **View Channel**, **Send Messages**, and **Embed Links** in the configured log channel. Autocomplete searches the server's roles and text channels and returns matching suggestions as you type.

## Directory structure

- `src/`: bot source code
- `data/`: per-server settings file
- `logs/`: announcement logs

## Security notes

- Do not commit `.env` or any tokens.
- Use the Discord Developer Portal to set an avatar and bot username.
- The bot only parses mentions explicitly present in an announcement and checks mention permissions in the destination channel.
- Grant announcement access with `/setting`; server administrators always retain access.

## Common issues

- If slash commands are not showing in the bot profile, run `npm run deploy:commands` and allow time for Discord's global command propagation.
- If the bot cannot send a message to a channel, check the bot permissions in that channel.
- If the config file is corrupted, fix it or delete it so the bot can recreate a valid default structure.
