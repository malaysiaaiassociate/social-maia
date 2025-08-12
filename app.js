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
// Store active usernames (case-insensitive)
const activeUsernames = new Set();

io.on("connection", function (socket) {
  console.log(`User connected: ${socket.id}`);
  
  socket.on("set-name", function (data) {
    const requestedName = data.name.trim();
    const requestedNameLower = requestedName.toLowerCase();
    
    // Check if username already exists (case-insensitive)
    if (activeUsernames.has(requestedNameLower)) {
      socket.emit("name-rejected", { 
        reason: "Username already taken." 
      });
      return;
    }
    
    // Check if username is too short or contains invalid characters
    if (requestedName.length < 2) {
      socket.emit("name-rejected", { 
        reason: "Must at least 2 characters long." 
      });
      return;
    }
    
    if (!/^[a-zA-Z0-9_-]+$/.test(requestedName)) {
      socket.emit("name-rejected", { 
        reason: "Username cannot contain space." 
      });
      return;
    }
    
    // If we reach here, the username is valid
    socket.userName = requestedName;
    socket.userGender = data.gender;
    activeUsernames.add(requestedNameLower);
    
    console.log(`User ${socket.id} set name to: ${requestedName}, gender: ${data.gender}`);
    
    // Broadcast user connection to all clients
    io.emit("user-connected", { name: requestedName, gender: data.gender });
    
    // Send existing users' locations to the newly named user
    connectedUsers.forEach((userData, userId) => {
      if (userId !== socket.id && userData.location) {
        socket.emit("receive-location", {
          id: userId,
          name: userData.name,
          gender: userData.gender,
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
      gender: socket.userGender,
      location: { latitude: data.latitude, longitude: data.longitude }
    });
    
    io.emit("receive-location", { id: socket.id, name: socket.userName, gender: socket.userGender, ...data });
  });

  socket.on("send-notification", function (data) {
    const displayName = socket.userName || socket.id;
    console.log(
      `Chat message received from ${displayName}: ${data.message}`
    );
    io.emit("receive-notification", { id: socket.id, name: socket.userName, gender: socket.userGender, ...data });
  });

  socket.on("disconnect", function () {
    const displayName = socket.userName || socket.id;
    console.log(`User disconnected: ${displayName} (${socket.id})`);
    
    // Broadcast user disconnection to all clients (only if user had a name)
    if (socket.userName) {
      io.emit("user-left", { name: socket.userName, gender: socket.userGender });
      // Remove username from active set
      activeUsernames.delete(socket.userName.toLowerCase());
    }
    
    // Remove user from connected users map
    connectedUsers.delete(socket.id);
    
    io.emit("user-disconnected", socket.id);
  });
});

app.get("/", function (req, res) {
  res.render("index");
});

server.listen(3000, () => {
  console.log("Server is running on port 3000");
});
