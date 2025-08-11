import { Server } from "socket.io";

let io;

export default function handler(req, res) {
  if (!res.socket.server.io) {
    console.log("Starting Socket.IO server...");
    io = new Server(res.socket.server, {
      path: "/api/socket",
      cors: {
        origin: "*",
        methods: ["GET", "POST"]
      }
    });

    io.on("connection", (socket) => {
      console.log("User connected:", socket.id);

      socket.on("send-location", (coords) => {
        // Broadcast to all connected clients
        socket.broadcast.emit("receive-location", {
          id: socket.id,
          coords
        });
      });

      socket.on("disconnect", () => {
        console.log("User disconnected:", socket.id);
        socket.broadcast.emit("user-disconnected", socket.id);
      });
    });

    res.socket.server.io = io;
  } else {
    console.log("Socket.IO server already running.");
  }
  res.end();
}
