import { useState } from "react";
import { DuelPractice } from "./components/DuelPractice.js";
import { HotseatGame } from "./components/HotseatGame.js";
import { Menu } from "./components/Menu.js";
import { OnlineGame } from "./components/OnlineGame.js";
import { useOnlineStore } from "./store/onlineStore.js";

type Mode = "menu" | "hotseat" | "ai" | "duel" | "online";

export function App(): JSX.Element {
  const [mode, setMode] = useState<Mode>("menu");
  const createRoom = useOnlineStore((s) => s.createRoom);
  const joinRoom = useOnlineStore((s) => s.joinRoom);

  if (mode === "hotseat") return <HotseatGame onLeave={() => setMode("menu")} />;
  if (mode === "ai") return <HotseatGame onLeave={() => setMode("menu")} vsAI />;
  if (mode === "duel") return <DuelPractice onLeave={() => setMode("menu")} />;
  if (mode === "online") return <OnlineGame onLeave={() => setMode("menu")} />;

  return (
    <Menu
      onHotseat={() => setMode("hotseat")}
      onVsAI={() => setMode("ai")}
      onDuelPractice={() => setMode("duel")}
      onCreate={() => {
        void createRoom();
        setMode("online");
      }}
      onJoin={(id) => {
        void joinRoom(id);
        setMode("online");
      }}
    />
  );
}
