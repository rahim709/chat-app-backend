import { WebSocketServer, WebSocket } from "ws";

const PORT = Number(process.env.PORT) || 8080;

const wss = new WebSocketServer({ port: PORT });

interface User {
  socket: WebSocket;
  roomId: string;
  userId: string;
}
let clientList: User[] = [];

interface Room {
  roomId: string;
  createdAt: number;
}
let roomCodeList: Room[] = [];

const ROOM_LIFETIME_MS = 20 * 60 * 1000;
const HEARTBEAT_INTERVAL_MS = 30000;

function getUserCount(roomId: string) {
  return clientList.filter((client) => client.roomId === roomId).length;
}

function assignUserId(roomId: string): string {
  const usedIds = new Set(
    clientList.filter((c) => c.roomId === roomId).map((c) => c.userId)
  );
  let index = 1;
  while (usedIds.has(`U${index}`)) {
    index++;
  }
  return `U${index}`;
}

function safeSend(socket: WebSocket, data: object): boolean {
  if (socket.readyState !== WebSocket.OPEN) return false;
  try {
    socket.send(JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

function broadcastUserCount(roomId: string) {
  const count = getUserCount(roomId);
  const staleClients: WebSocket[] = [];

  for (const client of clientList) {
    if (client.roomId === roomId) {
      const sent = safeSend(client.socket, {
        type: "user_count",
        count,
      });
      if (!sent) staleClients.push(client.socket);
    }
  }

  if (staleClients.length > 0) {
    clientList = clientList.filter((c) => !staleClients.includes(c.socket));
  }

  console.log(`[COUNT] ${roomId} | broadcasting count: ${count}`);
}

function cleanupExpiredRooms() {
  const now = Date.now();
  roomCodeList = roomCodeList.filter((room) => {
    const hasUsers = clientList.some((client) => client.roomId === room.roomId);
    return hasUsers || now - room.createdAt < ROOM_LIFETIME_MS;
  });
}

setInterval(cleanupExpiredRooms, 60 * 1000);

wss.on("connection", (socket) => {
  const autoCloseTimer = setTimeout(() => {
    if (socket.readyState === WebSocket.OPEN) {
      safeSend(socket, {
        type: "timeout",
        message: "Session expired after 20 minutes.",
      });
      socket.close();
    }
  }, ROOM_LIFETIME_MS);

  const heartbeatTimer = setInterval(() => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.ping();
    }
  }, HEARTBEAT_INTERVAL_MS);

  socket.on("pong", () => {});

  socket.on("message", (message) => {
    let parsedMessage: Record<string, unknown>;
    try {
      parsedMessage = JSON.parse(message.toString()) as Record<string, unknown>;
    } catch {
      safeSend(socket, {
        type: "error",
        message: "Invalid JSON message",
      });
      return;
    }

    const type = parsedMessage.type;
    if (typeof type !== "string") {
      safeSend(socket, {
        type: "error",
        message: "Missing message type",
      });
      return;
    }

    if (type === "create_room") {
      const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

      function generateRoomCode() {
        let code = "";
        for (let i = 0; i < 6; i++) {
          code += chars[Math.floor(Math.random() * chars.length)];
        }
        return code;
      }

      let code = "";
      do {
        code = generateRoomCode();
      } while (roomCodeList.some((room) => room.roomId === code));

      roomCodeList.push({ roomId: code, createdAt: Date.now() });

      safeSend(socket, {
        type: "room_created",
        roomId: code,
      });
    }

    if (type === "join") {
      const payload = parsedMessage.payload as { roomId?: string } | undefined;
      const roomId = payload?.roomId;

      if (typeof roomId !== "string") {
        safeSend(socket, {
          type: "join_failed",
          message: "Invalid room ID",
        });
        return;
      }

      const roomExists = roomCodeList.some((room) => room.roomId === roomId);
      if (!roomExists) {
        safeSend(socket, {
          type: "join_failed",
          message: "Room not found",
        });
        return;
      }

      const existingUser = clientList.find(
        (client) => client.socket === socket && client.roomId === roomId
      );

      const userId = existingUser?.userId ?? assignUserId(roomId);

      if (!existingUser) {
        clientList.push({ socket, roomId, userId });
      }

      safeSend(socket, {
        type: "join_success",
        message: "Connected to room",
        userId,
        roomId,
      });

      console.log(`[JOIN] ${roomId} | total users: ${getUserCount(roomId)}`);

      broadcastUserCount(roomId);
    }

    if (type === "chat") {
      const payload = parsedMessage.payload as
        | { roomId?: string; message?: string }
        | undefined;
      const roomId = payload?.roomId;
      const msg = payload?.message;

      if (typeof roomId !== "string" || typeof msg !== "string") {
        safeSend(socket, {
          type: "error",
          message: "Invalid chat payload",
        });
        return;
      }

      const sender = clientList.find(
        (client) => client.socket === socket && client.roomId === roomId
      );
      const senderId = sender?.userId ?? "Unknown";

      const staleClients: WebSocket[] = [];
      let recipientCount = 0;

      for (const client of clientList) {
        if (client.roomId === roomId && client.socket !== socket) {
          const sent = safeSend(client.socket, {
            type: "chat",
            message: msg,
            senderId,
          });
          if (sent) {
            recipientCount++;
          } else {
            staleClients.push(client.socket);
          }
        }
      }

      if (staleClients.length > 0) {
        clientList = clientList.filter((c) => !staleClients.includes(c.socket));
      }

      console.log(`[CHAT] ${roomId} | ${senderId}: "${msg}" | recipients: ${recipientCount}`);
    }
  });

  socket.on("close", () => {
    clearTimeout(autoCloseTimer);
    clearInterval(heartbeatTimer);

    const userRooms = clientList
      .filter((c) => c.socket === socket)
      .map((c) => c.roomId);

    clientList = clientList.filter((c) => c.socket !== socket);

    userRooms.forEach((roomId) => {
      broadcastUserCount(roomId);
    });

    cleanupExpiredRooms();
  });
});

console.log(`WebSocket server running on port ${PORT}`);
