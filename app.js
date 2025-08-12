const express = require("express");
const app = express();
const http = require("http");
const socketio = require("socket.io");
const path = require("path");
const server = http.createServer(app);
const io = socketio(server);

app.set("view engine", "ejs");
app.use(express.static(path.join(__dirname, "public")));

// Store connected users and their latest location data
const connectedUsers = new Map();

io.on("connection", function (socket) {
  console.log(`User connected: ${socket.id}`);
  
  socket.on("set-name", function (data) {
    socket.userName = data.name;
    console.log(`User ${socket.id} set name to: ${data.name}`);
    
    // Send existing users' locations to the newly named user
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
  
  socket.on("send-location", function (data) {
    const displayName = socket.userName || socket.id;
    console.log(
      `Location received from ${displayName}: ${data.latitude}, ${data.longitude}`
    );
    
    // Store user's location data
    connectedUsers.set(socket.id, {
      name: socket.userName,
      location: { latitude: data.latitude, longitude: data.longitude }
    });
    
    io.emit("receive-location", { id: socket.id, name: socket.userName, ...data });
  });

  socket.on("send-notification", function (data) {
    const displayName = socket.userName || socket.id;
    console.log(
      `Chat message received from ${displayName}: ${data.message}`
    );
    io.emit("receive-notification", { id: socket.id, name: socket.userName, ...data });
  });

  socket.on("disconnect", function () {
    const displayName = socket.userName || socket.id;
    console.log(`User disconnected: ${displayName} (${socket.id})`);
    
    // Remove user from connected users map
    connectedUsers.delete(socket.id);
    
    io.emit("user-disconnected", socket.id);
  });
});

app.get("/", function (req, res) {
  res.render("index");
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server is running on port ${PORT}`);
});
