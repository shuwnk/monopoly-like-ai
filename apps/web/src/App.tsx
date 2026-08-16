import { useEffect, useRef, useState } from "react";
import { AdminPanel } from "./components/AdminPanel.js";
import { AirportPractice } from "./components/AirportPractice.js";
import { BarnBrawlPractice } from "./components/BarnBrawlPractice.js";
import { BombermanPractice } from "./components/BombermanPractice.js";
import { BrawlPractice } from "./components/BrawlPractice.js";
import { Controls } from "./components/Controls.js";
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
import { useProfile } from "./store/profile.js";

type Mode = "admin" | "controls" | "menu" | "hotseat" | "ai" | "duel" | "airport" | "copa" | "wintest" | "floorbrawl" | "floordrop" | "floordrop-online" | "brawl" | "bomber" | "barn" | "shop" | "online";

export function App(): JSX.Element {
  const [mode, setMode] = useState<Mode>("menu");
  // a room code from an invite link, waiting on a name before we join
  const [invite, setInvite] = useState("");
  const createRoom = useOnlineStore((s) => s.createRoom);
  const joinRoom = useOnlineStore((s) => s.joinRoom);

  // On load, in order: resume a session stashed before a refresh (the server holds the
  // seat for a short window), else follow an invite link (?room=CODE) straight into that
  // room. The code is dropped from the URL afterwards so a later refresh resumes the
  // session rather than trying to join a room we're already seated in. Runs once.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    void useOnlineStore
      .getState()
      .restoreSession()
      .then((ok) => {
        if (ok) {
          setMode("online");
          return;
        }
        if (new URLSearchParams(window.location.search).has("admin")) {
          setMode("admin");
          return;
        }
        const code = new URLSearchParams(window.location.search).get("room")?.trim();
        if (!code) return;
        window.history.replaceState(null, "", window.location.pathname);
        // straight in if we already know who they are; otherwise hold them on the
        // menu with the code filled so they can put a name on before joining
        if (useProfile.getState().name.trim()) {
          void joinRoom(code);
          setMode("online");
        } else {
          setInvite(code);
        }
      });
  }, [joinRoom]);

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
  if (mode === "controls") return <Controls onLeave={() => setMode("menu")} />;
  if (mode === "online") return <OnlineGame onLeave={() => setMode("menu")} />;
  if (mode === "admin") return <AdminPanel onLeave={() => setMode("menu")} />;

  return (
    <Menu
      invite={invite}
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
      onControls={() => setMode("controls")}
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
