import { useEffect } from 'react';
import { useMainButton, haptic } from '../lib/telegram.js';
import { formatLada, shortAddress } from '../lib/format.js';

export default function ResultScreen({ race, myAddress, refunded, onDone }) {
  const won = !refunded && race.winner === myAddress;
  const lost = !refunded && race.loser  === myAddress;

  useEffect(() => {
    if (won)  haptic.success();
    else if (lost) haptic.error();
    return useMainButton('Done', onDone);
  }, [won, lost, onDone]);

  if (refunded) {
    return (
      <div className="result">
        <div className="result__medal">⌛</div>
        <div className="result__title is-lose">Race refunded</div>
        <p style={{ color: 'var(--fg-muted)', textAlign: 'center' }}>
          A reveal didn't land in time. Your {formatLada(race.stake)} LADA is on its way back.
        </p>
      </div>
    );
  }

  return (
    <div className="result">
      <div className="result__medal">{won ? '🏆' : '💨'}</div>
      <div className={`result__title ${won ? 'is-win' : 'is-lose'}`}>
        {won ? 'Pobeda!' : 'Pothole claimed you'}
      </div>
      <div className="result__amount">
        {won ? `+${formatLada(race.winner_payout)} LADA` : `-${formatLada(race.stake)} LADA`}
      </div>
      <p style={{ color: 'var(--fg-muted)', textAlign: 'center', marginTop: 8 }}>
        Winner: <b>{shortAddress(race.winner)}</b><br/>
        Pot: {formatLada(race.pot)} LADA · house took {formatLada(race.house_fee)} LADA
      </p>
    </div>
  );
}
