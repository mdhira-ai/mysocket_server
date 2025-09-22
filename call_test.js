const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Store user information
const users = new Map();
const activeChannels = new Map(); // Track which users are in which channels
const activeCalls = new Map(); // Track call participants: callId -> {caller, callee, channelName}

// Add route to validate channel access
app.post('/validate-channel', (req, res) => {
  const { channelName, userId } = req.body;
  
  console.log(`Channel validation request: ${userId} wants to join ${channelName}`);
  console.log('Active calls:', Array.from(activeCalls.entries()));
  
  // Check if user is authorized for this channel
  for (const [callId, callInfo] of activeCalls.entries()) {
    if (callInfo.channelName === channelName) {
      if (callInfo.caller === userId || callInfo.callee === userId) {
        console.log(`Authorization granted for ${userId} to join ${channelName}`);
        return res.json({ authorized: true });
      }
    }
  }
  
  console.log(`Authorization denied for ${userId} to join ${channelName}`);
  return res.json({ authorized: false, message: 'Not authorized for this channel' });
});

const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Extract user info from query
  const { userId, userName } = socket.handshake.query;
  
  // Store user information
  const user = {
    id: userId,
    name: userName,
    socketId: socket.id,
    isOnline: true,
    isInCall: false
  };
  
  users.set(userId, user);
  console.log(`User ${userName} (${userId}) connected`);

  // Broadcast updated user list to all clients
  broadcastUserList();

  // Handle user status updates
  socket.on('update-call-status', (data) => {
    const user = users.get(userId);
    if (user) {
      user.isInCall = data.isInCall;
      console.log(`User ${user.name} call status updated: ${data.isInCall ? 'in call' : 'available'}`);
      broadcastUserList();
    }
  });

  // Handle user info updates (like name changes)
  socket.on('update-user-info', (data) => {
    const { userId: updateUserId, userName } = data;
    const user = users.get(updateUserId);
    
    if (user && updateUserId === userId) { // Ensure user can only update their own info
      const oldName = user.name;
      user.name = userName;
      console.log(`User ${oldName} changed name to ${userName}`);
      broadcastUserList();
    }
  });

  // Handle make call request
  socket.on('make-call', (data) => {
    const { callId, to, from, channelName } = data;
    const targetUser = users.get(to);
    const callerUser = users.get(from.id);

    console.log(`Call request from ${from.name} to ${targetUser?.name}`);

    if (!targetUser) {
      socket.emit('call-failed', { message: 'User not found' });
      return;
    }

    if (!targetUser.isOnline) {
      socket.emit('call-failed', { message: 'User is offline' });
      return;
    }

    if (targetUser.isInCall) {
      socket.emit('call-failed', { 
        message: 'User is busy', 
        reason: 'user_busy',
        targetUser: targetUser.name 
      });
      return;
    }

    if (callerUser && callerUser.isInCall) {
      socket.emit('call-failed', { message: 'You are already in a call' });
      return;
    }

    // Store call information for authorization
    activeCalls.set(callId, {
      caller: from.id,
      callee: to,
      channelName: channelName,
      status: 'calling'
    });

    // Send incoming call to target user ONLY
    io.to(targetUser.socketId).emit('incoming-call', {
      callId,
      from,
      channelName
    });

    console.log(`Incoming call sent to ${targetUser.name} only`);
  });

  // Handle call acceptance
  socket.on('accept-call', (data) => {
    const { callId, channelName } = data;
    const user = users.get(userId);
    const callInfo = activeCalls.get(callId);
    
    // Verify this user is authorized to accept this call
    if (!callInfo || callInfo.callee !== userId) {
      console.log(`Unauthorized call acceptance attempt by ${user?.name}`);
      return;
    }
    
    if (user) {
      user.isInCall = true;
      // Add both users to active channel
      activeChannels.set(channelName, new Set([callInfo.caller, callInfo.callee]));
      
      // Update call status
      callInfo.status = 'active';
    }

    // Notify ONLY the caller that call was accepted
    const callerUser = users.get(callInfo.caller);
    if (callerUser) {
      io.to(callerUser.socketId).emit('call-accepted', { channelName });
      // Update caller status
      callerUser.isInCall = true;
    }
    
    console.log(`Call ${callId} accepted by ${user?.name}, notified caller only`);
    
    broadcastUserList();
  });

  // Handle call rejection
  socket.on('reject-call', (data) => {
    const { callId, reason } = data;
    const user = users.get(userId);
    const callInfo = activeCalls.get(callId);
    
    // Verify this user is authorized to reject this call
    if (!callInfo || callInfo.callee !== userId) {
      console.log(`Unauthorized call rejection attempt by ${user?.name}`);
      return;
    }
    
    console.log(`Call ${callId} rejected by ${user?.name}, reason: ${reason || 'none'}`);
    
    // Notify ONLY the caller that call was rejected
    const callerUser = users.get(callInfo.caller);
    if (callerUser) {
      io.to(callerUser.socketId).emit('call-rejected', { reason });
    }
    
    // Clean up call info
    activeCalls.delete(callId);
  });

  // Handle call end
  socket.on('end-call', () => {
    const user = users.get(userId);
    if (!user) return;

    // Find which call this user is in
    let userCallId = null;
    let callInfo = null;
    
    for (const [callId, info] of activeCalls.entries()) {
      if (info.caller === userId || info.callee === userId) {
        userCallId = callId;
        callInfo = info;
        break;
      }
    }
    
    if (!callInfo) {
      console.log(`User ${user.name} tried to end call but is not in any call`);
      return;
    }
    
    // Get the other participant
    const otherUserId = callInfo.caller === userId ? callInfo.callee : callInfo.caller;
    const otherUser = users.get(otherUserId);
    
    // Update both users' status
    user.isInCall = false;
    if (otherUser) {
      otherUser.isInCall = false;
    }
    
    // Remove from active channels
    if (activeChannels.has(callInfo.channelName)) {
      activeChannels.delete(callInfo.channelName);
    }
    
    // Notify ONLY the other participant that call ended
    if (otherUser) {
      io.to(otherUser.socketId).emit('call-ended');
      console.log(`Call ended by ${user.name}, notified ${otherUser.name} only`);
    }
    
    // Clean up call info
    activeCalls.delete(userCallId);
    
    broadcastUserList();
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    const user = users.get(userId);
    if (user) {
      console.log(`User ${user.name} disconnected`);
      
      // Find and clean up any active calls this user was in
      for (const [callId, callInfo] of activeCalls.entries()) {
        if (callInfo.caller === userId || callInfo.callee === userId) {
          // Get the other participant
          const otherUserId = callInfo.caller === userId ? callInfo.callee : callInfo.caller;
          const otherUser = users.get(otherUserId);
          
          // Notify only the other participant
          if (otherUser) {
            otherUser.isInCall = false;
            io.to(otherUser.socketId).emit('call-ended');
            console.log(`${user.name} disconnected, notified ${otherUser.name} about call end`);
          }
          
          // Clean up call and channel
          activeCalls.delete(callId);
          if (activeChannels.has(callInfo.channelName)) {
            activeChannels.delete(callInfo.channelName);
          }
        }
      }
      
      users.delete(userId);
      broadcastUserList();
    }
  });

  function broadcastUserList() {
    const userList = Array.from(users.values()).map(user => ({
      id: user.id,
      name: user.name,
      isOnline: user.isOnline,
      isInCall: user.isInCall
    }));
    
    io.emit('users-online', userList);
    console.log('Broadcasting user list:', userList.map(u => `${u.name}(${u.isInCall ? 'busy' : 'available'})`));
  }
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Socket server running on port ${PORT}`);
});

