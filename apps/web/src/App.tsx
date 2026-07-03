import { useState } from "react";
import { AirportPractice } from "./components/AirportPractice.js";
import { CopaPractice } from "./components/CopaPractice.js";
import { DuelPractice } from "./components/DuelPractice.js";
import { HotseatGame } from "./components/HotseatGame.js";
import { Menu } from "./components/Menu.js";
import { OnlineGame } from "./components/OnlineGame.js";
import { WinTest } from "./components/WinTest.js";
import { useOnlineStore } from "./store/onlineStore.js";

type Mode = "menu" | "hotseat" | "ai" | "duel" | "airport" | "copa" | "wintest" | "online";

export function App(): JSX.Element {
  const [mode, setMode] = useState<Mode>("menu");
  const createRoom = useOnlineStore((s) => s.createRoom);
  const joinRoom = useOnlineStore((s) => s.joinRoom);

  if (mode === "hotseat") return <HotseatGame onLeave={() => setMode("menu")} />;
  if (mode === "ai") return <HotseatGame onLeave={() => setMode("menu")} vsAI />;
  if (mode === "duel") return <DuelPractice onLeave={() => setMode("menu")} />;
  if (mode === "airport") return <AirportPractice onLeave={() => setMode("menu")} />;
  if (mode === "copa") return <CopaPractice onLeave={() => setMode("menu")} />;
  if (mode === "wintest") return <WinTest onLeave={() => setMode("menu")} />;
  if (mode === "online") return <OnlineGame onLeave={() => setMode("menu")} />;

  return (
    <Menu
      onHotseat={() => setMode("hotseat")}
      onVsAI={() => setMode("ai")}
      onDuelPractice={() => setMode("duel")}
      onAirportPractice={() => setMode("airport")}
      onCopaPractice={() => setMode("copa")}
      onWinTest={() => setMode("wintest")}
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
