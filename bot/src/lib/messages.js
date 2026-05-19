export const welcome = (name) =>
  `Welcome, ${name}!\n\nReady to race your Lada down some genuine Russian roads? Open the app below to enter a lobby.`;

export const lobbyJoined = ({ opponentName, stake }) =>
  `${opponentName} just joined your lobby (${stake} LADA). Tap "Open Lada Racing" to commit your secret.`;

export const raceStarting = ({ raceId }) =>
  `Race #${raceId} is starting — open the app and reveal your secret to determine the winner.`;

export const winnerAnnounced = ({ won, payout }) =>
  won
    ? `You won ${payout} LADA! Mind the potholes next time too.`
    : `Tough luck — your opponent dodged more potholes. Try another race?`;
