// const express = require("express");
// const app = express();
// const path = require("path");
// const http = require("http");

// const server = http.createServer(app);
// const socketio = require("socket.io");
// const io = socketio(server);

// app.set("view engine", "ejs");
// app.use(express.json());
// app.use(express.static(path.join(__dirname, "public")));
// app.use(express.urlencoded({ extended: true }));

// io.on("connection", function (socket) {
//   socket.on("send-location", function (data) {
//     io.emit("receive-location", { id: socket.id, ...data });
//   });
//   socket.on("disconnect", function () {
//     io.emit("user-disconnected", socket.id);
//   });
//   console.log("Connected to socket", socket.id);
// });

// app.get("/", (req, res) => {
//   res.render("index");
// });

// server.listen(3000, function (err, res) {
//   console.log("Listening to PORT 3000");
// });
const express = require("express");
const app = express();
const http = require("http");
const socketio = require("socket.io");
const path = require("path");
const server = http.createServer(app);
const io = socketio(server);

// Set the ejs and setup static files
app.set("view engine", "ejs");
app.use(express.static(path.join(__dirname, "public")));

io.on("connection", function (socket) {
  console.log(`User connected: ${socket.id}`);
  socket.on("send-location", function (data) {
    console.log(
      `Location received from ${socket.id}: ${data.latitude}, ${data.longitude}`
    );
    io.emit("receive-location", { id: socket.id, ...data });
  });

  socket.on("disconnect", function () {
    console.log(`User disconnected: ${socket.id}`);
    io.emit("user-disconnected", socket.id);
  });
});

app.get("/", function (req, res) {
  res.render("index");
});

server.listen(3000, () => {
  console.log("Server is running on port 3000");
});
