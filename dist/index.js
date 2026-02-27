import { WebSocketServer, WebSocket } from "ws";
const wss = new WebSocketServer({ port: 8080 });
let clientList = [];
let roomCodeList = [];
// Count users in a room
function getUserCount(roomId) {
    return clientList.filter(client => client.roomId === roomId).length;
}
// Broadcast user count
function broadcastUserCount(roomId) {
    const count = getUserCount(roomId);
    for (let client of clientList) {
        if (client.roomId === roomId) {
            client.socket.send(JSON.stringify({
                type: "user_count",
                count
            }));
        }
    }
}
wss.on("connection", (socket) => {
    //  Auto disconnect user after 20 minutes
    const autoCloseTimer = setTimeout(() => {
        if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({
                type: "timeout",
                message: "Session expired after 20 minutes."
            }));
            socket.close();
        }
    }, 20 * 60 * 1000); // 20 minutes
    socket.on("message", (message) => {
        const parsedMessage = JSON.parse(message.toString());
        // CREATE ROOM
        if (parsedMessage.type === "create_room") {
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
            } while (roomCodeList.some(room => room.roomId === code));
            roomCodeList.push({ roomId: code });
            socket.send(JSON.stringify({
                type: "room_created",
                roomId: code
            }));
        }
        // JOIN ROOM
        if (parsedMessage.type === "join") {
            const roomId = parsedMessage.payload.roomId;
            const roomExists = roomCodeList.some(room => room.roomId === roomId);
            if (!roomExists) {
                socket.send(JSON.stringify({
                    type: "join_failed",
                    message: "Room not found"
                }));
                return;
            }
            const alreadyJoined = clientList.some(client => client.socket === socket && client.roomId === roomId);
            if (!alreadyJoined) {
                clientList.push({ socket, roomId });
            }
            socket.send(JSON.stringify({
                type: "join_success",
                message: "Connected to room",
                roomId
            }));
            broadcastUserCount(roomId);
        }
        // CHAT
        if (parsedMessage.type === "chat") {
            const roomId = parsedMessage.payload.roomId;
            const msg = parsedMessage.payload.message;
            for (let client of clientList) {
                if (client.roomId === roomId && client.socket !== socket) {
                    client.socket.send(JSON.stringify({
                        messgae: msg
                    }));
                }
            }
        }
    });
    socket.on("close", () => {
        clearTimeout(autoCloseTimer);
        // Find user rooms
        const userRooms = clientList
            .filter(c => c.socket === socket)
            .map(c => c.roomId);
        // Remove user
        clientList = clientList.filter(c => c.socket !== socket);
        // Broadcast new count
        userRooms.forEach(roomId => {
            broadcastUserCount(roomId);
        });
    });
});
//# sourceMappingURL=index.js.map