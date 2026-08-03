import { useEffect, useRef, useState } from "react";
import { AirportPractice } from "./components/AirportPractice.js";
import { BarnBrawlPractice } from "./components/BarnBrawlPractice.js";
import { BombermanPractice } from "./components/BombermanPractice.js";
import { BrawlPractice } from "./components/BrawlPractice.js";
import { CopaPractice } from "./components/CopaPractice.js";
import { DuelPractice } from "./components/DuelPractice.js";
import { FloorBrawlPractice } from "./components/FloorBrawlPractice.js";
import { FloorDropPractice } from "./components/FloorDropPractice.js";
import { OnlineFloorDrop } from "./components/OnlineFloorDrop.js";
import { HotseatGame } from "./components/HotseatGame.js";
import { Menu } from "./components/Menu.js";
import { OnlineGame } from "./components/OnlineGame.js";
import { Shop } from "./components/Shop.js";
import { WinTest } from "./components/WinTest.js";
import { useOnlineStore } from "./store/onlineStore.js";

type Mode = "menu" | "hotseat" | "ai" | "duel" | "airport" | "copa" | "wintest" | "floorbrawl" | "floordrop" | "floordrop-online" | "brawl" | "bomber" | "barn" | "shop" | "online";

export function App(): JSX.Element {
  const [mode, setMode] = useState<Mode>("menu");
  const createRoom = useOnlineStore((s) => s.createRoom);
  const joinRoom = useOnlineStore((s) => s.joinRoom);

  // on load, if a session was stashed before a refresh, jump back into the online game and
  // reconnect (the server holds the seat for a short window). Runs once.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    void useOnlineStore
      .getState()
      .restoreSession()
      .then((ok) => {
        if (ok) setMode("online");
      });
  }, []);

  if (mode === "hotseat") return <HotseatGame onLeave={() => setMode("menu")} />;
  if (mode === "ai") return <HotseatGame onLeave={() => setMode("menu")} vsAI />;
  if (mode === "duel") return <DuelPractice onLeave={() => setMode("menu")} />;
  if (mode === "airport") return <AirportPractice onLeave={() => setMode("menu")} />;
  if (mode === "copa") return <CopaPractice onLeave={() => setMode("menu")} />;
  if (mode === "wintest") return <WinTest onLeave={() => setMode("menu")} />;
  if (mode === "floorbrawl") return <FloorBrawlPractice onLeave={() => setMode("menu")} />;
  if (mode === "floordrop") return <FloorDropPractice onLeave={() => setMode("menu")} />;
  if (mode === "floordrop-online") return <OnlineFloorDrop onLeave={() => setMode("menu")} />;
  if (mode === "brawl") return <BrawlPractice onLeave={() => setMode("menu")} />;
  if (mode === "bomber") return <BombermanPractice onLeave={() => setMode("menu")} />;
  if (mode === "barn") return <BarnBrawlPractice onLeave={() => setMode("menu")} />;
  if (mode === "shop") return <Shop onLeave={() => setMode("menu")} />;
  if (mode === "online") return <OnlineGame onLeave={() => setMode("menu")} />;

  return (
    <Menu
      onHotseat={() => setMode("hotseat")}
      onVsAI={() => setMode("ai")}
      onDuelPractice={() => setMode("duel")}
      onAirportPractice={() => setMode("airport")}
      onCopaPractice={() => setMode("copa")}
      onWinTest={() => setMode("wintest")}
      onFloorBrawl={() => setMode("floorbrawl")}
      onFloorDrop={() => setMode("floordrop")}
      onFloorDropOnline={() => setMode("floordrop-online")}
      onBrawl={() => setMode("brawl")}
      onBomber={() => setMode("bomber")}
      onBarn={() => setMode("barn")}
      onShop={() => setMode("shop")}
      onCreate={(durationSec, maxPlayers) => {
        void createRoom(durationSec, maxPlayers);
        setMode("online");
      }}
      onJoin={(id) => {
        void joinRoom(id);
        setMode("online");
      }}
    />
  );
}
