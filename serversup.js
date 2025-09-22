const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const cors = require("cors");
const supabase = require("./supaconnection");

// Global error handlers
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
  process.exit(1);
});

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*", // Your Next.js frontend URL
    methods: ["GET", "POST"],
  },
});

app.use(cors());
app.use(express.json());

// Store active connections
const activeConnections = new Map();

// Helper function to get online auth users
async function getOnlineAuthUsers() {
  try {
    const { data, error } = await supabase
      .from("socket_users")
      .select("*")
      .eq("status", "online")
      .eq("group", "auth_user");

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error("Error fetching online auth users:", error);
    return [];
  }
}

// Helper function to update user status
async function updateUserStatus(socketId, status, additionalData = {}) {
  try {
    const { data, error } = await supabase
      .from("socket_users")
      .update({
        status,
        ...additionalData,
      })
      .eq("socket_id", socketId)
      .select();

    if (error) throw error;
    return data?.[0];
  } catch (error) {
    console.error("Error updating user status:", error);
    return null;
  }
}

// Helper function to upsertUser
async function upsertUser(userData) {
  try {
    // First, try to find existing user by session_id or email
    let existingUser = null;

    if (userData.session_id) {
      const { data, error } = await supabase
        .from("socket_users")
        .select("*")
        .eq("session_id", userData.session_id)
        .single();

      // Only throw error if it's not a "not found" error
      if (error && error.code !== "PGRST116") {
        throw error;
      }
      existingUser = data;
    }

    if (existingUser) {
      // Update existing user
      const { data, error } = await supabase
        .from("socket_users")
        .update({
          socket_id: userData.socket_id,
          status: "online",
          connect_at: new Date().toISOString(),
          which_page: userData.which_page || null,
        })
        .eq("id", existingUser.id)
        .select();

      if (error) throw error;
      return data?.[0];
    } else {
      // Create new user
      const { data, error } = await supabase
        .from("socket_users")
        .insert([
          {
            socket_id: userData.socket_id,
            email: userData.email || null,
            session_id: userData.session_id || null,
            name: userData.name || null,
            connect_at: new Date().toISOString(),
            which_page: userData.which_page || null,
            status: "online",
            group: userData.email ? "auth_user" : "anonymous",
          },
        ])
        .select();

      if (error) throw error;
      return data?.[0];
    }
  } catch (error) {
    console.error("Error upserting user:", error);
    return null;
  }
}

// Helper function to broadcast online users to all clients
async function broadcastOnlineUsers() {
  const onlineUsers = await getOnlineAuthUsers();
  io.emit("online_users_updated", onlineUsers);
}

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  // Store socket reference
  activeConnections.set(socket.id, socket);

  // socket for admin
  socket.on("admin_join", async (msg) => {
    try {
      console.log("Admin joining:", msg);
      //   save admin socket to database
      let { data, error } = await supabase
        .from("socket_users")
        .select("*")
        .eq("socket_id", socket.id)
        .single();

      if (error && error.code !== "PGRST116") {
        // PGRST116 is "not found" error
        throw error;
      }

      if (data) {
        // already exists, update
        let { data: updatedData, error: updateError } = await supabase
          .from("socket_users")
          .update({
            group: "admin",
            status: "online",
            connect_at: new Date().toISOString(),
          })
          .eq("id", data.id)
          .select();
        if (updateError) throw updateError;
        console.log("Admin updated successfully:", updatedData);
      } else {
        // create new
        let { data: newData, error: insertError } = await supabase
          .from("socket_users")
          .insert([
            {
              socket_id: socket.id,
              group: "admin",
              status: "online",
              connect_at: new Date().toISOString(),
            },
          ])
          .select();
        if (insertError) throw insertError;
        console.log("Admin created successfully:", newData);
      }
    } catch (error) {
      console.error("Error handling admin join:", error);
      socket.emit("error", { message: "Failed to join as admin" });
    }
  });

  // Handle user joining
  socket.on("user_join", async (userData) => {
    try {
      console.log("User joining:", userData);

      const userRecord = await upsertUser({
        socket_id: socket.id,
        email: userData.email,
        session_id: userData.session_id,
        name: userData.name,
        which_page: userData.which_page,
      });

      if (userRecord) {
        socket.userId = userRecord.id;
        socket.userGroup = userRecord.group;

        // Send current user data back to the client
        socket.emit("user_connected", userRecord);

        // If it's an auth user, broadcast updated online users
        if (userRecord.group === "auth_user") {
          await broadcastOnlineUsers();
        }

        console.log("User joined successfully:", userRecord);
      }
    } catch (error) {
      console.error("Error handling user join:", error);
      socket.emit("error", { message: "Failed to join" });
    }
  });

  // send notification to specific client for AET admin
  socket.on("notify", async (data) => {
    const { toSocketId, message } = data;

    try {
      // get the group of the toSocketId in supabase database
      let { data: userData, error } = await supabase
        .from("socket_users")
        .select("*")
        .eq("socket_id", socket.id)
        .single();
      if (error) throw error;
      if (!userData) {
        socket.emit("error", { message: "User not found" });
        return;
      }

      console.log("Sending notification from group:", userData.group);
      io.to(toSocketId).emit("notification", {
        from: userData.group,
        message: message,
      });
      console.log("Notification sent to:", toSocketId);
    } catch (error) {
      console.error("Error sending notification:", error);
      socket.emit("error", { message: "Failed to send notification" });
    }
  });

  //   poke someone
  socket.on("poke", async (data) => {
    try {
      const { to } = data;

      // Get user information from supabase database
      let { data: userData, error } = await supabase
        .from("socket_users")
        .select("*")
        .eq("socket_id", socket.id)
        .single();

      if (error) throw error;

      io.to(to).emit("poke_from", {
        from: socket.id,
        fromName: userData.name || "Anonymous",
        message: "You have been poked!",
        fromEmail: userData.email || "",
      });

      console.log(`Poke sent from ${socket.id} to ${to}`);
    } catch (error) {
      console.error("Error handling poke:", error);
      socket.emit("error", { message: "Failed to send poke" });
    }
  });

  // Handle page change
  socket.on("page_change", async (data) => {
    try {
      await updateUserStatus(socket.id, "online", {
        which_page: data.page,
      });
      console.log(`User ${socket.id} changed page to: ${data.page}`);
    } catch (error) {
      console.error("Error handling page change:", error);
    }
  });

  // Handle user going offline
  socket.on("user_offline", async () => {
    await handleUserDisconnect(socket);
  });

  // Handle disconnect
  socket.on("disconnect", async () => {
    await handleUserDisconnect(socket);
  });
});

async function handleUserDisconnect(socket) {
  try {
    console.log("User disconnected:", socket.id);

    // Update user status to offline
    const updatedUser = await updateUserStatus(socket.id, "offline");

    // Remove from active connections
    activeConnections.delete(socket.id);

    // If it was an auth user, broadcast updated online users
    if (socket.userGroup === "auth_user") {
      await broadcastOnlineUsers();
    }

    console.log("User disconnected successfully:", socket.id);
  } catch (error) {
    console.error("Error handling disconnect:", error);
  }
}

// API endpoint to get current online users
// app.get("/api/online-users", async (req, res) => {
//   try {
//     const onlineUsers = await getOnlineAuthUsers();
//     res.json(onlineUsers);
//   } catch (error) {
//     console.error("Error fetching online users:", error);
//     res.status(500).json({ error: "Failed to fetch online users" });
//   }
// });

// Cleanup offline users periodically (optional)
// setInterval(async () => {
//   try {
//     // Mark users as offline if they haven't been seen for more than 5 minutes
//     const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

//     const { data, error } = await supabase
//       .from('socket_users')
//       .update({ status: 'offline' })
//       .lt('connect_at', fiveMinutesAgo)
//       .eq('status', 'online')
//       .select();

//     if (data && data.length > 0) {
//       console.log(`Marked ${data.length} users as offline due to inactivity`);
//       await broadcastOnlineUsers();
//     }
//   } catch (error) {
//     console.error('Error in cleanup job:', error);
//   }
// }, 60000); // Run every minute

const PORT = 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
