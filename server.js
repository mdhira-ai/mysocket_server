const express = require("express");
const { createServer } = require("node:http");
const { Server } = require("socket.io");
const cors = require("cors");

const { create, read, update, remove } = require("./crud");
const port = 3001;

const app = express();
app.use(cors());
app.use(express.json());

const server = createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
    },
});


//table schema
// CREATE TABLE "users_status" (
// 	"id"	INTEGER,
// 	"status"	INTEGER,
// 	"which_page"	TEXT,
// 	"socket_id"	TEXT,
// 	"connected_at"	TEXT,
// 	"email"	TEXT,
// 	"name"	TEXT,
// 	"session_id"	TEXT,
// 	"group"	TEXT,
// 	PRIMARY KEY("id" AUTOINCREMENT)
// )


// Clear all data on server startup
const clearAllUsersStatus = () => {
    return new Promise((resolve, reject) => {
        remove("users_status", "", [], (err, changes) => {
            if (err) {
                reject(err);
            } else {
                resolve(changes);
            }
        });
    });
};



// Clear database on startup
clearAllUsersStatus()
    .then(() => {
        console.log("Database cleared on startup");
    })
    .catch((err) => {
        console.error("Error clearing database on startup:", err);
    });


const getAllUsersStatus = () => {
    return new Promise((resolve, reject) => {
        read("users_status", "", [], (err, rows) => {
            if (err) {
                reject(err);
            } else {
                resolve(rows);
            }
        });
    });
};

// Helper function to get user by socket_id
const getUserBySocketId = (socketId) => {
    return new Promise((resolve, reject) => {
        read("users_status", "WHERE socket_id = ?", [socketId], (err, rows) => {
            if (err) {
                reject(err);
            } else {
                resolve(rows[0] || null);
            }
        });
    });
};

// Helper function to create new user status entry
const createUserStatus = (status, whichPage, socketId, email, name, sessionId, group) => {
    return new Promise((resolve, reject) => {
        const data = {
            status: status,
            which_page: whichPage || "home",
            socket_id: socketId,
            connected_at: new Date().toISOString(),
            email: email || "",
            name: name || "",
            session_id: sessionId || "",
            group: group || "anonymous",
        };

        create("users_status", data, (err, lastID) => {
            if (err) {
                reject(err);
            } else {
                resolve(lastID);
            }
        });
    });
};

// Helper function to update user status
const updateUserStatus = (socketId, status, whichPage = null) => {
    return new Promise((resolve, reject) => {
        const updateData = { status: status };
        if (whichPage) {
            updateData.which_page = whichPage;
        }

        update(
            "users_status",
            updateData,
            "WHERE socket_id = ?",
            [socketId],
            (err, changes) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(changes);
                }
            }
        );
    });
};

// Helper function to remove user status by socket_id
const removeUserStatus = (socketId) => {
    return new Promise((resolve, reject) => {
        remove(
            "users_status",
            "WHERE socket_id = ?",
            [socketId],
            (err, changes) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(changes);
                }
            }
        );
    });
};

// Helper function to broadcast user status to all clients
const broadcastUserStatus = async () => {
    try {
        io.emit("users_status_update", await getAllUsersStatus());
    } catch (error) {
        console.error("Error broadcasting user status:", error);
    }
};

const getuserbyemail = (email) => {
    return new Promise((resolve, reject) => {
        read("users_status", "WHERE email = ?", [email], (err, rows) => {
            if (err) {
                reject(err);
            } else {
                resolve(rows);
            }
        });
    });
};


const updateuserstatusandsocketid = (email, socketId, status, whichPage = null) => {
    return new Promise((resolve, reject) => {
        const updateData = { status: status, socket_id: socketId };
        if (whichPage) {
            updateData.which_page = whichPage;
        }

        update(
            "users_status",
            updateData,
            "WHERE email = ?",
            [email],
            (err, changes) => {
                if (err) {
                    reject(err);
                } else {    
                    resolve(changes);
                }
            }
        );
    });
};

io.on("connection", async (socket) => {
    console.log("a user connected", socket.id);

    await createUserStatus(1, "/", socket.id, "", "", "");
    await broadcastUserStatus();

    // send notification to specific client
    socket.on("notify", (data) => {
        const { toSocketId, message } = data;

        io.to(toSocketId).emit("notification", {
            from: socket.id,
            message: message,
        });
        console.log("Notification sent to:", toSocketId);
    });

    socket.on("user_connected_auth", async(data) => {
        const { userId, email, which_page, name } = data ;
        // console.log("User connected data:", data);
        console.log(`User connected: ${userId}, Email: ${email}, Page: ${which_page}, Name: ${name}`);
        

        // await updateuserstatusandsocketid(email, socket.id, 1, which_page);

        // Broadcast updated user list to all connected clients
        // await broadcastUserStatus();
    });

  




    // Get current users list
    socket.on("get_users", async () => {
        try {
            const users = await getAllUsersStatus();
            socket.emit("users_list", users);
        } catch (error) {
            console.error("Error getting users list:", error);
            socket.emit("users_list", []);
        }
    });

    // Handle user disconnect
    socket.on("disconnect", async () => {
        try {
            // Remove from database
            await updateUserStatus(socket.id, 0);

            console.log(`User ID: ${socket.id} disconnected `);

            // Broadcast updated user list to all remaining connected clients
            await broadcastUserStatus();
        } catch (error) {
            console.error("Error handling user disconnection:", error);
        }
    });
});


app.get("/", (req, res) => {
    res.send("<h1>Hello World!</h1>");
});

server.listen(port, () => {

    console.log(`server running at http://localhost:${port}`);
});
