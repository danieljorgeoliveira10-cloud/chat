const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http);
const mysql = require("mysql2");
const bcrypt = require("bcrypt");

app.use(express.static("public"));
app.use(express.json());

const db = mysql.createConnection({
  host:"localhost",
  user:"root",
  password:"",
  database:"chat_db"
});
db.connect(err=>{
  if(err) throw err;
  console.log("Conectado ao MySQL");
});

let users = []; 

app.get("/private/:username", (req,res)=>{
  res.sendFile(__dirname + "/public/chat_privado.html");
});

io.on("connection", socket => {
  console.log("Novo usuário conectado");

  
  socket.on("login", data => {
    db.query("SELECT * FROM users WHERE username=?", [data.username], (err,res) => {
      if(err) return socket.emit("login_error","Erro no servidor");
      if(res.length === 0) return socket.emit("login_error","Usuário não existe");
      bcrypt.compare(data.password, res[0].password, (err,result)=>{
        if(result){
          socket.username = data.username;
          const existing = users.find(u=>u.username===data.username);
          if(existing) existing.online = true;
          else users.push({username:data.username, online:true, last_online:new Date()});
          socket.emit("login_ok");
          io.emit("updateUsers", users);

          
          db.query("SELECT * FROM messages ORDER BY timestamp ASC", (err,msgs)=>{
            if(!err) socket.emit("loadMessages", msgs.map(m=>({user:m.sender,text:m.text})));
          });
        } else socket.emit("login_error","Senha incorreta");
      });
    });
  });

  //cadastro
  socket.on("register", data=>{
    db.query("SELECT * FROM users WHERE username=?", [data.username], (err,res)=>{
      if(err) return socket.emit("register_error","Erro no servidor");
      if(res.length>0) return socket.emit("register_error","Usuário já existe");
      bcrypt.hash(data.password,10,(err,hash)=>{
        if(err) return socket.emit("register_error","Erro ao cadastrar");
        db.query("INSERT INTO users(username,password) VALUES (?,?)", [data.username,hash], err=>{
          if(err) return socket.emit("register_error","Erro ao cadastrar");
          socket.emit("register_ok");
        });
      });
    });
  });


  socket.on("message", m=>{
    db.query("INSERT INTO messages(sender,text) VALUES (?,?)", [m.user,m.text], err=>{
      if(!err) io.emit("message", m);
    });
  });

  // Digit
  socket.on("typing", u=>{
    socket.broadcast.emit("typing", u);
  });

  
  socket.on("privateMessage", m=>{
    db.query("INSERT INTO private_messages(sender,receiver,text) VALUES (?,?,?)", [m.from,m.to,m.text], err=>{
      if(!err) {
        
        io.sockets.sockets.forEach(s=>{
          if(s.username===m.from || s.username===m.to){
            s.emit("privateMessage", m);
          }
        });
      }
    });
  });

  
  socket.on("loadPrivate", data=>{
    db.query(
      "SELECT * FROM private_messages WHERE (sender=? AND receiver=?) OR (sender=? AND receiver=?) ORDER BY timestamp ASC",
      [data.from,data.to,data.to,data.from],
      (err,res)=>{
        if(!err) socket.emit("loadPrivateMessages", res.map(m=>({from:m.sender,text:m.text})));
      }
    );
  });

  
  socket.on("typingPrivate", data=>{

    io.sockets.sockets.forEach(s=>{
      if(s.username === data.to){
        s.emit("typingPrivate", data);
      }
    });
  });

  
  socket.on("disconnect", ()=>{
    if(socket.username){
      users = users.map(u=>{
        if(u.username===socket.username) return {...u, online:false, last_online:new Date()};
        return u;
      });
      io.emit("updateUsers", users);
    }
  });
});

http.listen(5000, ()=>console.log("Servidor rodando em http://localhost:5000"));