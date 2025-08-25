const express = require("express");
const fs = require("fs");
const multer = require("multer");
const app = express();
const upload = multer({ dest: "uploads/" });

let botInstance = null;
let botRunning = false;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public")); // index.html serve kare

app.post("/start", upload.single("appstate"), (req, res) => {
  if (!req.file || !req.body.owner) return res.json({ message: "AppState & Owner UID required!" });
  fs.copyFileSync(req.file.path, "appstate.json");
  fs.writeFileSync("owner.txt", req.body.owner);

  if (!botRunning) {
    botRunning = true;
    botInstance = require("./bot.js");
    return res.json({ message: "Bot started ✅" });
  } else {
    return res.json({ message: "Bot already running!" });
  }
});

app.post("/stop", (req, res) => {
  if (botRunning && botInstance) {
    if (botInstance.stopBot) botInstance.stopBot();
    botInstance = null;
    botRunning = false;
    return res.json({ message: "Bot stopped ✅" });
  } else {
    return res.json({ message: "Bot is not running!" });
  }
});

app.get("/status", (req, res) => {
  res.json({ running: botRunning });
});

app.listen(20782, () => console.log("🌐 WebPanel running: http://localhost:20782"));
