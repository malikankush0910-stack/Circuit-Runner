const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Owner and Admin Configuration
const GAME_OWNER_USERNAME = 'Hurtrain';
const adminUsernames = new Set([GAME_OWNER_USERNAME]);

// In-Memory Storage & Persistence Files
const USERS_FILE = './users.json';
const BANS_FILE = './banned.json';

let usersDatabase = fs.existsSync(USERS_FILE) ? JSON.parse(fs.readFileSync(USERS_FILE)) : [];
let bannedUsers = fs.existsSync(BANS_FILE) ? JSON.parse(fs.readFileSync(BANS_FILE)) : [];

function saveUsers() { fs.writeFileSync(USERS_FILE, JSON.stringify(usersDatabase, null, 2)); }
function saveBans() { fs.writeFileSync(BANS_FILE, JSON.stringify(bannedUsers, null, 2)); }

function isAdmin(username) {
  return username && adminUsernames.has(username);
}

// Authentication Routes
app.post('/api/login', (req, res) => {
  const { username } = req.body;
  if (bannedUsers.includes(username)) {
    return res.status(403).json({ error: 'This account has been permanently banned.' });
  }
  let user = usersDatabase.find(u => u.username === username);
  if (!user) {
    user = { username, inventory: [] };
    usersDatabase.push(user);
    saveUsers();
  }
  res.json({ success: true, user });
});

// Socket Handler
io.on('connection', (socket) => {
  socket.on('authenticate', ({ username }) => {
    if (bannedUsers.includes(username)) {
      socket.emit('banned_notification', { reason: 'Your account is banned.' });
      return socket.disconnect(true);
    }
    socket.username = username;
    socket.emit('auth_success', { username, isAdmin: isAdmin(username) });
  });

  // OWNER & ADMIN COMMANDS
  socket.on('admin_give_admin', ({ targetUsername }) => {
    if (!isAdmin(socket.username)) return socket.emit('admin_error', 'Unauthorized.');
    adminUsernames.add(targetUsername);
    io.emit('admin_granted', { username: targetUsername, grantedBy: socket.username });
    socket.emit('admin_success', `Admin privileges granted to ${targetUsername}.`);
  });

  socket.on('admin_get_item', ({ itemId, quantity = 1 }) => {
    if (!isAdmin(socket.username)) return socket.emit('admin_error', 'Unauthorized.');
    let user = usersDatabase.find(u => u.username === socket.username);
    if (!user) return socket.emit('admin_error', 'User not found.');

    if (!user.inventory) user.inventory = [];
    const item = user.inventory.find(i => i.id === itemId);
    if (item) { item.count += quantity; } else { user.inventory.push({ id: itemId, count: quantity }); }

    saveUsers();
    socket.emit('inventory_updated', user.inventory);
    socket.emit('admin_success', `Added ${quantity}x [${itemId}] to inventory.`);
  });

  socket.on('admin_ban_player', ({ targetUsername, reason }) => {
    if (!isAdmin(socket.username)) return socket.emit('admin_error', 'Unauthorized.');
    if (targetUsername === GAME_OWNER_USERNAME) return socket.emit('admin_error', 'Cannot ban the Game Owner!');

    if (!bannedUsers.includes(targetUsername)) {
      bannedUsers.push(targetUsername);
      saveBans();
    }

    for (let [id, s] of io.sockets.sockets) {
      if (s.username === targetUsername) {
        s.emit('banned_notification', { reason: reason || 'Banned by Administrator.' });
        s.disconnect(true);
      }
    }
    socket.emit('admin_success', `Player ${targetUsername} banned.`);
  });

  socket.on('admin_get_player', ({ targetUsername }) => {
    if (!isAdmin(socket.username)) return socket.emit('admin_error', 'Unauthorized.');
    const targetData = usersDatabase.find(u => u.username === targetUsername);
    if (!targetData) return socket.emit('admin_error', 'User not found.');
    socket.emit('admin_player_data', targetData);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));