import { Server } from "colyseus";
import { FloorDropRoom } from "./FloorDropRoom.js";
import { GameRoom } from "./GameRoom.js";

const port = Number(process.env.PORT) || 2567;
// Bind every interface, not just loopback: a container host (Railway et al) routes
// traffic in from outside the container and can't reach a loopback-only listener.
const host = process.env.HOST ?? "0.0.0.0";

const gameServer = new Server();
gameServer.define("game", GameRoom);
gameServer.define("floordrop", FloorDropRoom);
await gameServer.listen(port, host);

// Colyseus only answers /matchmake/* — every other path gets an empty reply, which
// makes "is the server up?" unanswerable from a browser and gives a host's health
// check nothing to probe. Prepending a handler leaves the matchmaking routes alone.
const http = gameServer.transport.server;
http?.prependListener("request", (req, res) => {
  if (req.url !== "/health") return;
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("ok");
});

console.log(`party-monopoly server listening on ${host}:${port}`);
