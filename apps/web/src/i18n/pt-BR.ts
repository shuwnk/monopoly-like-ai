import type { Catalog } from "./index.js";

// Brazilian Portuguese — the first translation, since the board is a tour of
// Brazil. The square names (Rio Branco, São Luís, …) are real place names and
// are deliberately left alone.
//
// Written by a non-native speaker: a Brazilian player should read it over,
// especially the game-specific terms (rent showdown / party round).
export const PT_BR: Catalog = {
  // menu + identity
  You: "Você",
  "your name": "seu nome",
  Character: "Personagem",
  Controls: "Controles",
  Local: "Local",
  Practice: "Treino",
  Online: "Online",
  Hotseat: "Mesmo PC",
  "Play vs AI": "Jogar contra a IA",
  Players: "Jogadores",
  "{n} players": "{n} jogadores",
  "Game length": "Duração",
  "{m} minutes": "{m} minutos",
  "Create room": "Criar sala",
  "room code": "código da sala",
  Join: "Entrar",
  Back: "Voltar",

  // lobby + online
  "{a} / {b} players in": "{a} / {b} jogadores na sala",
  "Waiting for one more…": "Esperando mais um…",
  "Start game ({n} in)": "Começar ({n} na sala)",
  "Waiting for the host to start…": "Esperando o anfitrião começar…",
  "waiting…": "esperando…",
  "Room code": "Código da sala",
  "Room code:": "Código da sala:",
  "Copy code": "Copiar código",
  "Copy invite link": "Copiar link de convite",
  "Copied ✓": "Copiado ✓",
  "Connecting…": "Conectando…",
  "In the lobby…": "Na sala de espera…",
  "Connection lost — reconnecting…": "Conexão perdida — reconectando…",
  "You were disconnected. The others played on without you.": "Você foi desconectado. Os outros continuaram jogando sem você.",
  "Error: {msg}": "Erro: {msg}",
  unknown: "desconhecido",

  // turn UI
  "Your turn.": "Sua vez.",
  "Waiting for {who}…": "Esperando {who}…",
  opponent: "adversário",
  "Rent showdown in progress…": "Duelo de aluguel em andamento…",
  "Roll dice": "Rolar dados",
  "Roll (try to escape jail)": "Rolar (tentar sair da prisão)",
  Buy: "Comprar",
  Decline: "Recusar",
  "End turn": "Encerrar turno",
  "Sell property": "Vender propriedade",
  "Done selling": "Pronto",
  "Game over.": "Fim de jogo.",
  "Winner:": "Vencedor:",

  // how to win
  "How to win": "Como vencer",
  "Everyone starts with {start}. A game ends three ways — whichever comes first.":
    "Todos começam com {start}. A partida termina de três formas — o que vier primeiro.",
  "Get rich": "Fique rico",
  "First player to {goal} net worth (cash plus what your properties and houses are worth) wins on the spot.":
    "O primeiro a alcançar {goal} de patrimônio (dinheiro mais o valor das suas propriedades e casas) vence na hora.",
  "Last one standing": "Último de pé",
  "Bankrupt everyone else. Run out of money with rent to pay and you're out.":
    "Leve todos os outros à falência. Ficou sem dinheiro com aluguel a pagar, está fora.",
  "Beat the clock": "Vença o relógio",
  "When the host's timer hits zero, the richest player takes it.": "Quando o tempo do anfitrião zerar, o jogador mais rico leva.",
  "Where the money comes from": "De onde vem o dinheiro",
  "Rent.": "Aluguel.",
  "Own a stall, charge whoever lands on it.": "Tenha uma propriedade e cobre de quem cair nela.",
  "Build.": "Construa.",
  "Land on your own stall and add a house — up to a hotel, worth {mult}× the bare rent.":
    "Caia na sua própria propriedade e adicione uma casa — até um hotel, que vale {mult}× o aluguel básico.",
  "Rent showdowns.": "Duelos de aluguel.",
  "Every rent payment is a reflex duel: tap first as the payer and you pay half, tap first as the owner and you collect {mult}×.":
    "Todo aluguel é um duelo de reflexo: toque primeiro como pagador e paga metade; como dono, recebe {mult}×.",
  "Party rounds.": "Rodadas de festa.",
  "Every {laps} laps everyone drops into a minigame; placement pays out, so skill can drag you back into the race.":
    "A cada {laps} voltas todos caem em um minijogo; a colocação paga, então habilidade te traz de volta para a disputa.",
  "Copa & Aeroporto.": "Copa e Aeroporto.",
  "Copa doubles one of your stalls' rent for good; Aeroporto flies you anywhere on the board.":
    "A Copa dobra para sempre o aluguel de uma propriedade sua; o Aeroporto te leva a qualquer casa do tabuleiro.",
  "Got it": "Entendi",

  // shop
  "Shop & Loadout": "Loja e Equipamento",
  "this is what others see": "é assim que os outros te veem",
  Colour: "Cor",
  Default: "Padrão",
  Accessory: "Acessório",
  None: "Nenhum",
  "Looks only — a helmet won't save you from anything.": "Só aparência — um capacete não te salva de nada.",
  Gear: "Equipamento",

  // controls
  "Used by every minigame. Click a key to change it, then press the new one — Esc cancels.":
    "Usado por todos os minijogos. Clique em uma tecla para trocar e pressione a nova — Esc cancela.",
  "press a key…": "pressione uma tecla…",
  "Add a second key": "Adicionar uma segunda tecla",
  "{key} is already used for “{action}”": "{key} já está em uso para “{action}”",
  "Reset to defaults": "Restaurar padrões",
  "Default: {keys} to move, Space to jump": "Padrão: {keys} para mover, Espaço para pular",
  "Move up": "Mover para cima",
  "Move down": "Mover para baixo",
  "Move left": "Mover para a esquerda",
  "Move right": "Mover para a direita",
  "Jump / place bomb": "Pular / soltar bomba",

  // language screen
  Language: "Idioma",
  "Translate the game": "Traduzir o jogo",
  translated: "traduzido",
  yours: "seu",
  Remove: "Remover",
  "Download template": "Baixar modelo",
  "Load a translation": "Carregar tradução",
  "Download the file, replace the English on the right of each line with your language, then load it back. You don't have to finish — anything you skip stays in English.":
    "Baixe o arquivo, troque o inglês do lado direito de cada linha pelo seu idioma e carregue de volta. Não precisa terminar — o que você pular continua em inglês.",
  "Added {label} — {pct}% translated.": "{label} adicionado — {pct}% traduzido.",
  "That file could not be read.": "Não foi possível ler esse arquivo.",
  'The file needs a "code", like "fr" or "ja".': 'O arquivo precisa de um "code", como "fr" ou "ja".',
  'The file needs a "label" — the language\'s name.': 'O arquivo precisa de um "label" — o nome do idioma.',
  'The file needs a "catalog" of translations.': 'O arquivo precisa de um "catalog" com as traduções.',
  "{n} strings in total. Send us a finished file and we'll ship it with the game.":
    "{n} textos no total. Nos mande um arquivo pronto e a gente inclui no jogo.",
};
