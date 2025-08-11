const express = require("express");
const http = require("http");
const socketio = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);

// Force Socket.IO to use polling only for Vercel compatibility
const io = socketio(server, {
  transports: ["polling"],
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.set("view engine", "ejs");
app.use(express.static(path.join(__dirname, "public")));

// Store connected users and their latest location data
const connectedUsers = new Map();

io.on("connection", (socket) => {
  console.log(`User connected: ${socket.id}`);

  socket.on("set-name", (data) => {
    socket.userName = data.name;
    console.log(`User ${socket.id} set name to: ${data.name}`);

    // Send existing users' locations to the new user
    connectedUsers.forEach((userData, userId) => {
      if (userId !== socket.id && userData.location) {
        socket.emit("receive-location", {
          id: userId,
          name: userData.name,
          latitude: userData.location.latitude,
          longitude: userData.location.longitude
        });
      }
    });
  });

  socket.on("send-location", (data) => {
    const displayName = socket.userName || socket.id;
    console.log(`Location from ${displayName}: ${data.latitude}, ${data.longitude}`);

    connectedUsers.set(socket.id, {
      name: socket.userName,
      location: { latitude: data.latitude, longitude: data.longitude }
    });

    io.emit("receive-location", { id: socket.id, name: socket.userName, ...data });
  });

  socket.on("send-notification", (data) => {
    const displayName = socket.userName || socket.id;
    console.log(`Notification from ${displayName}: ${data.message}`);
    io.emit("receive-notification", { id: socket.id, name: socket.userName, ...data });
  });

  socket.on("disconnect", () => {
    const displayName = socket.userName || socket.id;
    console.log(`User disconnected: ${displayName} (${socket.id})`);
    connectedUsers.delete(socket.id);
    io.emit("user-disconnected", socket.id);
  });
});

app.get("/", (req, res) => {
  res.render("index");
});

// Export app & server for Vercel
module.exports = { app, server };

// Local development
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}
