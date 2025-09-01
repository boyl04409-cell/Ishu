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

// === Start Bot ===
app.post("/start", upload.single("appstate"), (req, res) => {
  if (!req.file || !req.body.owner)
    return res.json({ message: "AppState & Owner UID required!" });

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

// === Stop Bot ===
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

// === Status Check ===
app.get("/status", (req, res) => {
  res.json({ running: botRunning });
});

// === Health Check (Render/Hosting purpose) ===
app.get("/healthz", (req, res) => {
  res.status(200).send("OK");
});

// === Server Start ===
const PORT = process.env.PORT || 20782;
app.listen(PORT, () =>
  console.log(`🌐 WebPanel running: http://localhost:${PORT}`)
);
