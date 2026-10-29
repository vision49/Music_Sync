const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs");
const multer = require("multer");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const musicDir = path.join(__dirname, "public", "uploads");
fs.mkdirSync(musicDir, { recursive: true });

// Playlist memory: separate playlist for each room
const roomPlaylists = new Map();

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, musicDir),
  filename: (req, file, cb) => {
    const safeName = path.basename(file.originalname)
      .replace(/[^a-zA-Z0-9._-]/g, "_");

    cb(null, `${Date.now()}-${safeName}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("audio/")) {
      cb(null, true);
    } else {
      cb(new Error("Only audio files are allowed"));
    }
  }
});

app.use(express.static(path.join(__dirname, "public")));

app.post("/upload", (req, res) => {
  upload.single("music")(req, res, (err) => {
    if (err) {
      return res.status(400).json({
        error: err.message || "Upload failed"
      });
    }

    if (!req.file) {
      return res.status(400).json({
        error: "Choose an audio file"
      });
    }

    res.json({
      name: req.file.originalname,
      url: `/uploads/${req.file.filename}`
    });
  });
});

io.on("connection", (socket) => {
  console.log("Friend connected:", socket.id);

  socket.on("join-room", (roomId) => {
    if (typeof roomId !== "string" ||
        !/^[a-zA-Z0-9_-]{1,40}$/.test(roomId)) {
      return;
    }

    socket.join(roomId);

    if (!roomPlaylists.has(roomId)) {
      roomPlaylists.set(roomId, []);
    }

    socket.emit("room-joined", roomId);
    socket.emit("playlist-updated", roomPlaylists.get(roomId));
  });

  socket.on("shared-music", (data) => {
    if (!data ||
        typeof data.roomId !== "string" ||
        typeof data.url !== "string" ||
        !data.url.startsWith("/uploads/") ||
        !socket.rooms.has(data.roomId)) {
      return;
    }

    const playlist = roomPlaylists.get(data.roomId) || [];

    const song = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: String(data.name || "Unknown song").slice(0, 150),
      url: data.url
    };

    playlist.push(song);
    roomPlaylists.set(data.roomId, playlist);

    io.to(data.roomId).emit("playlist-updated", playlist);
  });

  socket.on("play-music", (data) => {
    if (data && typeof data.roomId === "string" &&
        socket.rooms.has(data.roomId)) {
      socket.to(data.roomId).emit("sync-play", data);
    }
  });

  socket.on("pause-music", (data) => {
    if (data && typeof data.roomId === "string" &&
        socket.rooms.has(data.roomId)) {
      socket.to(data.roomId).emit("sync-pause", data);
    }
  });

  socket.on("disconnect", () => {
    console.log("Friend disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Music Sync server running on port ${PORT}`);
});