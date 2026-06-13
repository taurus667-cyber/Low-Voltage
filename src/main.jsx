import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { supabase, isSupabaseConfigured } from './lib/supabase.js';
import { calculateLeaderboard, isFinalScoreComplete } from './lib/scoring.js';
import { calculateLiveLeaderboard, livePredictionPoints } from './lib/livePoints.js';
import { getActiveTournament, scopedRows } from './lib/tournament.js';
import {
  getLiveStatusLabel,
  getMatchLockReason,
  isMatchLive,
  isMatchLocked,
  isMatchPlayed,
  isMatchUpcoming,
} from './lib/matches.js';
import {
  parseFixtureCsv,
  parseFixtureJson,
  normalizeFixtureRows,
} from './lib/fixtures.js';
import './styles.css';

const ADMIN_PASSWORD = import.meta.env.VITE_ADMIN_PASSWORD || '';
const STATUSES = ['scheduled', 'live', 'finished'];

function App() {
  const [route, setRoute] = useRoute();
  const [player, setPlayer] = useStoredPlayer();
  const [players, setPlayers] = useState([]);
  const [matches, setMatches] = useState([]);
  const [predictions, setPredictions] = useState([]);
  const [tournaments, setTournaments] = useState([]);
  const [matchEvents, setMatchEvents] = useState([]);
  const [matchStatistics, setMatchStatistics] = useState([]);
  const [matchLineups, setMatchLineups] = useState([]);
  const [predictionAids, setPredictionAids] = useState([]);
  const [matchOdds, setMatchOdds] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const refresh = async () => {
    if (!isSupabaseConfigured) return;
    setLoading(true);
    setError('');
    try {
      const [tournamentRows, playerRows, matchRows, predictionRows, eventRows, statisticRows, lineupRows, aidRows, oddsRows] = await Promise.all([
        optionalSelect(supabase.from('tournaments').select('*').order('created_at')),
        supabase.from('players').select('*').order('created_at'),
        supabase.from('matches').select('*').order('kickoff_time'),
        supabase.from('predictions').select('*').order('submitted_at'),
        optionalSelect(supabase.from('match_events').select('*').order('elapsed')),
        optionalSelect(supabase.from('match_statistics').select('*')),
        optionalSelect(supabase.from('match_lineups').select('*')),
        optionalSelect(supabase.from('match_prediction_aids').select('*').order('aid_type')),
        optionalSelect(supabase.from('match_odds').select('*')),
      ]);
      throwIfError(playerRows.error);
      throwIfError(matchRows.error);
      throwIfError(predictionRows.error);
      setTournaments(tournamentRows.data || []);
      setPlayers(playerRows.data || []);
      setMatches(matchRows.data || []);
      setPredictions(predictionRows.data || []);
      setMatchEvents(eventRows.data || []);
      setMatchStatistics(statisticRows.data || []);
      setMatchLineups(lineupRows.data || []);
      setPredictionAids(aidRows.data || []);
      setMatchOdds(oddsRows.data || []);
    } catch (err) {
      setError(err.message || 'Could not load data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const navigate = (nextRoute) => {
    window.history.pushState({}, '', nextRoute);
    setRoute(nextRoute);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const activeTournament = getActiveTournament(tournaments);
  const scopedPlayers = scopedRows(players, activeTournament);
  const scopedMatches = scopedRows(matches, activeTournament);
  const scopedPredictions = scopedRows(predictions, activeTournament);

  const pageProps = {
    player,
    setPlayer,
    players: scopedPlayers,
    matches: scopedMatches,
    predictions: scopedPredictions,
    tournament: activeTournament,
    matchEvents: scopedRows(matchEvents, activeTournament),
    matchStatistics: scopedRows(matchStatistics, activeTournament),
    matchLineups: scopedRows(matchLineups, activeTournament),
    predictionAids: scopedRows(predictionAids, activeTournament),
    matchOdds: scopedRows(matchOdds, activeTournament),
    refresh,
    loading,
    message,
    setMessage,
    error,
    setError,
    navigate,
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => navigate('/')}>
          {activeTournament.name} Picks
        </button>
        <nav aria-label="Primary navigation">
          <button className={route === '/matches' ? 'active' : ''} onClick={() => navigate('/matches')}>
            Matches
          </button>
          <button className={route === '/predictions' ? 'active' : ''} onClick={() => navigate('/predictions')}>
            Picks
          </button>
          <button className={route === '/leaderboard' ? 'active' : ''} onClick={() => navigate('/leaderboard')}>
            Leaderboard
          </button>
          <button className={route === '/admin' ? 'active' : ''} onClick={() => navigate('/admin')}>
            Admin
          </button>
        </nav>
      </header>

      {!isSupabaseConfigured && (
        <div className="banner error">
          Add your Supabase URL and anon key in environment variables, then redeploy or restart the dev server.
        </div>
      )}
      {message && <div className="banner success">{message}</div>}
      {error && <div className="banner error">{error}</div>}

      <main>
        {route === '/' && <HomePage {...pageProps} />}
        {route === '/matches' && <MatchesPage {...pageProps} />}
        {route === '/predictions' && <PredictionsPage {...pageProps} />}
        {route === '/leaderboard' && <LeaderboardPage {...pageProps} />}
        {route === '/admin' && <AdminPage {...pageProps} />}
      </main>
    </div>
  );
}

function HomePage({ player, setPlayer, players, refresh, setMessage, setError, navigate, tournament }) {
  const [name, setName] = useState(player?.name || '');
  const [matches, setMatches] = useState([]);

  const savePlayer = async (mode = 'auto') => {
    const cleanName = name.trim();
    setMessage('');
    setError('');
    if (!cleanName) {
      setError('Please enter your display name.');
      return;
    }

    const sameName = players.filter(
      (item) => isPlayerActive(item) && normalizePlayerName(item.name) === normalizePlayerName(cleanName),
    );
    if (sameName.length && mode === 'auto') {
      setMatches(sameName);
      return;
    }

    try {
      if (mode.startsWith('existing:')) {
        const existing = sameName.find((item) => item.id === mode.replace('existing:', ''));
        if (!existing) throw new Error('That player was not found.');
        setPlayer(existing);
        setMessage(`Welcome back, ${existing.name}.`);
        navigate('/matches');
        return;
      }

      const token = crypto.randomUUID();
      const { data, error } = await supabase
        .from('players')
        .insert({
          name: cleanName,
          player_token: token,
          is_active: true,
          ...(tournament.id ? { tournament_id: tournament.id } : {}),
        })
        .select()
        .single();
      throwIfError(error);
      setPlayer(data);
      await refresh();
      setMessage(`Welcome, ${data.name}.`);
      navigate('/matches');
    } catch (err) {
      if (isUniqueViolation(err)) {
        setError('That display name is already registered. Use the existing profile.');
        await refresh();
        return;
      }
      setError(err.message || 'Could not save player.');
    }
  };

  return (
    <section className="hero">
      <div>
        <p className="eyebrow">Private friends group</p>
        <h1>Predict {tournament.name} scores.</h1>
        <p className="hero-copy">
          Enter your name, pick match scores, then watch the leaderboard update as results are added.
        </p>
      </div>
      <div className="entry-panel">
        <label htmlFor="player-name">Display name</label>
        <input
          id="player-name"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setMatches([]);
          }}
          placeholder="Your WhatsApp name"
          maxLength={40}
        />
        <button className="primary" onClick={() => savePlayer()}>
          Continue
        </button>
        {player && (
          <button className="ghost" onClick={() => navigate('/matches')}>
            Continue as {player.name}
          </button>
        )}
        {matches.length > 0 && (
          <div className="duplicate-box">
            <strong>Name already exists.</strong>
            <span>Use the existing profile for this display name.</span>
            {matches.map((item) => (
              <button key={item.id} onClick={() => savePlayer(`existing:${item.id}`)}>
                Use {item.name}
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function MatchesPage({
  player,
  players,
  matches,
  predictions,
  refresh,
  loading,
  setMessage,
  setError,
  navigate,
  matchEvents,
  matchStatistics,
  matchLineups,
  predictionAids,
  matchOdds,
  tournament,
}) {
  const [matchView, setMatchView] = useState('upcoming');
  const publishedMatches = matches.filter((match) => match.is_published);
  const currentPlayer = players.find((item) => item.id === player?.id) || player;
  const playersById = useMemo(() => new Map(players.map((item) => [item.id, item])), [players]);
  const predictionsByMatch = useMemo(() => {
    const map = new Map();
    predictions
      .filter((prediction) => prediction.player_id === currentPlayer?.id)
      .forEach((prediction) => map.set(prediction.match_id, prediction));
    return map;
  }, [predictions, currentPlayer]);
  const activePredictionsByMatch = useMemo(() => {
    const map = new Map();
    predictions.forEach((prediction) => {
      const predictedPlayer = playersById.get(prediction.player_id);
      if (!isPlayerActive(predictedPlayer)) return;
      const rows = map.get(prediction.match_id) || [];
      rows.push(prediction);
      map.set(prediction.match_id, rows);
    });
    map.forEach((rows) => {
      rows.sort((a, b) =>
        getPlayerDisplayName(playersById.get(a.player_id)).localeCompare(
          getPlayerDisplayName(playersById.get(b.player_id)),
        ),
      );
    });
    return map;
  }, [predictions, playersById]);
  const upcomingMatches = useMemo(
    () =>
      publishedMatches
        .filter((match) => isMatchUpcoming(match))
        .sort((a, b) => new Date(a.kickoff_time).getTime() - new Date(b.kickoff_time).getTime()),
    [publishedMatches],
  );
  const liveMatches = useMemo(
    () =>
      publishedMatches
        .filter((match) => isMatchLive(match))
        .sort((a, b) => new Date(a.kickoff_time).getTime() - new Date(b.kickoff_time).getTime()),
    [publishedMatches],
  );
  const playedMatches = useMemo(
    () =>
      publishedMatches
        .filter((match) => isMatchPlayed(match))
        .sort((a, b) => new Date(b.kickoff_time).getTime() - new Date(a.kickoff_time).getTime()),
    [publishedMatches],
  );
  const visibleMatches = matchView === 'played' ? playedMatches : upcomingMatches;
  const liveLeaderboard = useMemo(
    () => calculateLiveLeaderboard(players, matches, predictions),
    [players, matches, predictions],
  );

  if (!currentPlayer) {
    return <NeedPlayer navigate={navigate} />;
  }
  if (!isPlayerActive(currentPlayer)) {
    return <InactivePlayer navigate={navigate} />;
  }

  return (
    <section>
      <PageTitle title="Matches" action={<button onClick={refresh}>Refresh</button>} />
      {loading && <p className="muted">Loading matches...</p>}
      {liveMatches.length > 0 && (
        <section className="live-section" aria-labelledby="live-now-title">
          <div className="section-heading">
            <h2 id="live-now-title">Live now</h2>
            <span>{liveMatches.length} active match{liveMatches.length === 1 ? '' : 'es'}</span>
          </div>
          <div className="match-list">
            {liveMatches.map((match) => (
              <PredictionCard
                key={match.id}
                match={match}
                prediction={predictionsByMatch.get(match.id)}
                submittedPredictions={activePredictionsByMatch.get(match.id) || []}
                playersById={playersById}
                player={currentPlayer}
                refresh={refresh}
                setMessage={setMessage}
                setError={setError}
                events={rowsForMatch(matchEvents, match.id)}
                statistics={rowsForMatch(matchStatistics, match.id)}
                lineups={rowsForMatch(matchLineups, match.id)}
                aids={rowsForMatch(predictionAids, match.id)}
                odds={rowsForMatch(matchOdds, match.id)}
                livePoints={liveLeaderboard.get(currentPlayer.id)?.live_points || 0}
                tournament={tournament}
              />
            ))}
          </div>
        </section>
      )}
      <div className="tab-row" role="tablist" aria-label="Match view">
        <button
          className={matchView === 'upcoming' ? 'active' : ''}
          onClick={() => setMatchView('upcoming')}
          role="tab"
          aria-selected={matchView === 'upcoming'}
        >
          Upcoming ({upcomingMatches.length})
        </button>
        <button
          className={matchView === 'played' ? 'active' : ''}
          onClick={() => setMatchView('played')}
          role="tab"
          aria-selected={matchView === 'played'}
        >
          Played ({playedMatches.length})
        </button>
      </div>
      <div className="match-list">
        {visibleMatches.map((match) => (
          <PredictionCard
            key={match.id}
            match={match}
            prediction={predictionsByMatch.get(match.id)}
            submittedPredictions={activePredictionsByMatch.get(match.id) || []}
            playersById={playersById}
            player={currentPlayer}
            refresh={refresh}
            setMessage={setMessage}
            setError={setError}
            events={rowsForMatch(matchEvents, match.id)}
            statistics={rowsForMatch(matchStatistics, match.id)}
            lineups={rowsForMatch(matchLineups, match.id)}
            aids={rowsForMatch(predictionAids, match.id)}
            odds={rowsForMatch(matchOdds, match.id)}
            livePoints={liveLeaderboard.get(currentPlayer.id)?.live_points || 0}
            tournament={tournament}
          />
        ))}
      </div>
      {!publishedMatches.length && <EmptyState text="No published matches yet. Ask the admin to import or add fixtures." />}
      {publishedMatches.length > 0 && !visibleMatches.length && (
        <EmptyState
          text={matchView === 'played' ? 'No played matches yet.' : 'No upcoming matches left.'}
        />
      )}
    </section>
  );
}

function PredictionCard({
  match,
  prediction,
  submittedPredictions,
  playersById,
  player,
  refresh,
  setMessage,
  setError,
  events = [],
  statistics = [],
  lineups = [],
  aids = [],
  odds = [],
  livePoints = 0,
  tournament,
}) {
  const [teamAScore, setTeamAScore] = useState(prediction?.predicted_team_a_score ?? '');
  const [teamBScore, setTeamBScore] = useState(prediction?.predicted_team_b_score ?? '');
  const locked = isMatchLocked(match);
  const lockReason = getMatchLockReason(match);
  const live = isMatchLive(match);
  const hasResult = !live && isFinalScoreComplete(match);
  const liveScore = getLiveScore(match);
  const currentPredictionPoints = livePredictionPoints(prediction, match);
  const aidItemCount = aids.length + odds.length + lineups.length;

  useEffect(() => {
    setTeamAScore(prediction?.predicted_team_a_score ?? '');
    setTeamBScore(prediction?.predicted_team_b_score ?? '');
  }, [prediction?.id, prediction?.predicted_team_a_score, prediction?.predicted_team_b_score]);

  const submit = async () => {
    setMessage('');
    setError('');
    const scoreA = parseScore(teamAScore);
    const scoreB = parseScore(teamBScore);
    if (locked) {
      setError('Predictions are locked for this match.');
      return;
    }
    if (scoreA === null || scoreB === null) {
      setError('Scores must be non-negative whole numbers.');
      return;
    }
    try {
      const { error } = await supabase.from('predictions').upsert(
        {
          player_id: player.id,
          match_id: match.id,
          ...((match.tournament_id || tournament?.id) ? { tournament_id: match.tournament_id || tournament.id } : {}),
          predicted_team_a_score: scoreA,
          predicted_team_b_score: scoreB,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'player_id,match_id' },
      );
      throwIfError(error);
      setMessage('Prediction saved.');
      await refresh();
    } catch (err) {
      setError(err.message || 'Could not save prediction.');
    }
  };

  return (
    <article className={`match-card${live ? ' live-card' : ''}`}>
      <div className="match-meta">
        <span>{match.stage || 'Match'}</span>
        {match.group_name && <span>{match.group_name}</span>}
        <span>{formatDate(match.kickoff_time)}</span>
        {live && <span className="live-pill">{getLiveStatusLabel(match)}</span>}
      </div>
      <div className="teams">
        <strong>{match.team_a}</strong>
        <span>vs</span>
        <strong>{match.team_b}</strong>
      </div>
      {match.venue && <p className="muted">{match.venue}</p>}
      {live && (
        <div className="live-status">
          {liveScore && <strong>Live: {liveScore}</strong>}
          {match.live_minute !== null && match.live_minute !== undefined && <span>{match.live_minute}'</span>}
          {match.live_status_note && <span>{match.live_status_note}</span>}
          {match.live_source && <span>{formatPublicSource(match.live_source)}</span>}
          {match.last_synced_at && <span>Synced {formatDate(match.last_synced_at)}</span>}
        </div>
      )}
      {live && (
        <MatchCentre
          events={events}
          statistics={statistics}
          lineups={lineups}
          currentPredictionPoints={currentPredictionPoints}
          livePoints={livePoints}
        />
      )}
      {!live && isMatchUpcoming(match) && (
        <PredictionAid match={match} aids={aids} odds={odds} lineups={lineups} itemCount={aidItemCount} />
      )}
      {hasResult && (
        <p className="result">
          Final: {match.team_a_score} - {match.team_b_score}
        </p>
      )}
      <div className="submitted-panel">
        <div className="submitted-header">
          <strong>Submitted by</strong>
          <span>{submittedPredictions.length} player{submittedPredictions.length === 1 ? '' : 's'}</span>
        </div>
        {submittedPredictions.length > 0 ? (
          <div className="submitted-list">
            {submittedPredictions.map((submittedPrediction) => (
              <span key={submittedPrediction.id}>
                {getPlayerDisplayName(playersById.get(submittedPrediction.player_id))}
              </span>
            ))}
          </div>
        ) : (
          <p className="muted">No players submitted a prediction yet.</p>
        )}
      </div>
      <div className="score-row">
        <label>
          {match.team_a}
          <input
            inputMode="numeric"
            min="0"
            type="number"
            value={teamAScore}
            onChange={(event) => setTeamAScore(event.target.value)}
            disabled={locked}
          />
        </label>
        <label>
          {match.team_b}
          <input
            inputMode="numeric"
            min="0"
            type="number"
            value={teamBScore}
            onChange={(event) => setTeamBScore(event.target.value)}
            disabled={locked}
          />
        </label>
      </div>
      <button className="primary" onClick={submit} disabled={locked}>
        {prediction ? 'Update prediction' : 'Submit prediction'}
      </button>
      {locked && <p className="lock-note">{lockReason}</p>}
    </article>
  );
}

function MatchCentre({ events, statistics, lineups, currentPredictionPoints, livePoints }) {
  const keyEvents = events.filter((event) =>
    ['Goal', 'Card', 'subst', 'Var'].some((type) => String(event.event_type || '').toLowerCase().includes(type.toLowerCase())),
  );
  const goalEvents = events.filter((event) => /goal/i.test(event.event_type || '') || /goal/i.test(event.event_detail || ''));
  const visibleStats = statistics.flatMap((row) =>
    Object.entries(row.statistics || {})
      .filter(([, value]) => value !== null && value !== undefined)
      .slice(0, 5)
      .map(([label, value]) => ({ team: row.team_name, label, value })),
  ).slice(0, 8);

  return (
    <details className="match-centre" open>
      <summary>Match centre</summary>
      <div className="live-points-row">
        <span>This pick now: {currentPredictionPoints === null ? 'n/a' : `${currentPredictionPoints} pts`}</span>
        <span>Your live total: {livePoints} pts</span>
      </div>
      {goalEvents.length > 0 && (
        <div className="event-group">
          <strong>Goals</strong>
          <div className="event-list">
            {goalEvents.map((event) => <EventChip key={event.id} event={event} />)}
          </div>
        </div>
      )}
      {keyEvents.length > 0 && (
        <div className="event-group">
          <strong>Key events</strong>
          <div className="event-list">
            {keyEvents.map((event) => <EventChip key={event.id} event={event} />)}
          </div>
        </div>
      )}
      {visibleStats.length > 0 && (
        <div className="stat-grid">
          {visibleStats.map((stat) => (
            <span key={`${stat.team}-${stat.label}`}>
              <strong>{stat.label}</strong>
              {stat.team}: {String(stat.value)}
            </span>
          ))}
        </div>
      )}
      {lineups.length > 0 && (
        <div className="lineup-row">
          {lineups.map((lineup) => (
            <span key={lineup.id}>{lineup.team_name} {lineup.formation ? `(${lineup.formation})` : ''}</span>
          ))}
        </div>
      )}
      {!events.length && !statistics.length && !lineups.length && (
        <p className="muted">Live event details will appear when the provider publishes them.</p>
      )}
    </details>
  );
}

function PredictionAid({ match, aids, odds, lineups, itemCount }) {
  const oddsInsight = buildOddsInsight(odds, match);
  if (!itemCount) {
    return (
      <div className="prediction-aid-status">
        <strong>Match insight</strong>
        <span>Waiting for match data for this game.</span>
      </div>
    );
  }
  return (
    <details className="prediction-aid" open>
      <summary>Match insight - latest data - {itemCount} item{itemCount === 1 ? '' : 's'}</summary>
      {oddsInsight && (
        <div className="odds-summary">
          <strong>Market view</strong>
          <span>{oddsInsight.favoriteLabel} is favored by the available odds.</span>
          {oddsInsight.syncedAt && <small>Odds synced {formatDate(oddsInsight.syncedAt)}</small>}
        </div>
      )}
      <div className="aid-grid">
        {odds.slice(0, 3).map((odd) => (
          <article key={odd.id} className="odds-card">
            <strong>{odd.bookmaker || 'Bookmaker odds'}</strong>
            <span className="aid-caption">{formatMarketName(odd.market)}</span>
            <div className="odds-options">
              {buildOddsOptions(odd, match).map((option) => (
                <span key={option.key} className={option.isFavorite ? 'favorite' : ''}>
                  <small>{option.label}</small>
                  <strong>{option.odd}</strong>
                  {option.probability && <em>{option.probability}</em>}
                </span>
              ))}
            </div>
            {odd.last_synced_at && <small>Synced {formatDate(odd.last_synced_at)}</small>}
          </article>
        ))}
        {aids.map((aid) => (
          <article key={aid.id}>
            <strong>{formatAidTitle(aid)}</strong>
            <span>{formatAidSummary(aid.summary, oddsInsight)}</span>
            {aid.last_synced_at && <small>Synced {formatDate(aid.last_synced_at)}</small>}
          </article>
        ))}
        {lineups.map((lineup) => (
          <article key={lineup.id}>
            <strong>{lineup.team_name} lineup</strong>
            <span>{lineup.formation || 'Formation pending'}</span>
            {lineup.last_synced_at && <small>Synced {formatDate(lineup.last_synced_at)}</small>}
          </article>
        ))}
      </div>
    </details>
  );
}

function buildOddsInsight(odds, match) {
  const rows = odds
    .map((odd) => ({
      home: parseDecimalOdd(odd.home_value),
      draw: parseDecimalOdd(odd.draw_value),
      away: parseDecimalOdd(odd.away_value),
      syncedAt: odd.last_synced_at,
    }))
    .filter((row) => row.home && row.draw && row.away);
  if (!rows.length) return null;
  const averages = {
    home: average(rows.map((row) => row.home)),
    draw: average(rows.map((row) => row.draw)),
    away: average(rows.map((row) => row.away)),
  };
  const favoriteKey = Object.entries(averages).sort(([, a], [, b]) => a - b)[0]?.[0];
  const labels = {
    home: match.team_a,
    draw: 'Draw',
    away: match.team_b,
  };
  return {
    favoriteLabel: labels[favoriteKey] || 'A team',
    syncedAt: rows.map((row) => row.syncedAt).filter(Boolean).sort().at(-1),
  };
}

function buildOddsOptions(odd, match) {
  const options = [
    { key: 'home', label: `${match.team_a} win`, value: odd.home_value },
    { key: 'draw', label: 'Draw', value: odd.draw_value },
    { key: 'away', label: `${match.team_b} win`, value: odd.away_value },
  ].map((option) => {
    const decimal = parseDecimalOdd(option.value);
    return {
      ...option,
      decimal,
      odd: decimal ? formatOdd(decimal) : '-',
      probability: decimal ? `about ${Math.round((1 / decimal) * 100)}% chance` : '',
    };
  });
  const favoriteDecimal = Math.min(...options.map((option) => option.decimal || Infinity));
  return options.map((option) => ({
    ...option,
    isFavorite: option.decimal === favoriteDecimal,
  }));
}

function parseDecimalOdd(value) {
  const parsed = Number.parseFloat(String(value || '').replace(',', '.'));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function formatOdd(value) {
  return value.toFixed(2).replace(/\.00$/, '');
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function EventChip({ event }) {
  const minute = event.elapsed !== null && event.elapsed !== undefined
    ? `${event.elapsed}${event.extra_time ? `+${event.extra_time}` : ''}'`
    : '';
  const assist = event.assist_name ? `, assist ${event.assist_name}` : '';
  return (
    <span>
      <strong>{minute}</strong>
      {event.team_name ? `${event.team_name}: ` : ''}
      {event.player_name || formatEventType(event.event_type)}
      {assist}
      {event.event_detail ? ` (${formatEventDetail(event.event_detail)})` : ''}
    </span>
  );
}

function LeaderboardPage({ players, matches, predictions, refresh }) {
  const rows = calculateLeaderboard(players, matches, predictions);
  const liveRows = calculateLiveLeaderboard(players, matches, predictions);
  return (
    <section>
      <PageTitle title="Leaderboard" action={<button onClick={refresh}>Refresh</button>} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Rank</th>
              <th>Player</th>
              <th>Points</th>
              <th>Live</th>
              <th>Exact</th>
              <th>Outcome</th>
              <th>Picks</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.player_id}>
                <td>{index + 1}</td>
                <td>{row.name}</td>
                <td><strong>{row.total_points}</strong></td>
                <td>{liveRows.get(row.player_id)?.live_points || 0}</td>
                <td>{row.exact_score_count}</td>
                <td>{row.correct_outcome_count}</td>
                <td>{row.predictions_submitted_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && <EmptyState text="Leaderboard will appear after players submit predictions and results are entered." />}
    </section>
  );
}

function PredictionsPage({ players, matches, predictions, refresh }) {
  const playersById = useMemo(() => new Map(players.map((player) => [player.id, player])), [players]);
  const activePlayerCount = useMemo(
    () => players.filter((player) => isPlayerActive(player)).length,
    [players],
  );
  const predictionsByMatch = useMemo(() => {
    const map = new Map();
    predictions.forEach((prediction) => {
      const rows = map.get(prediction.match_id) || [];
      rows.push(prediction);
      map.set(prediction.match_id, rows);
    });
    map.forEach((rows) => {
      rows.sort((a, b) => {
        const playerA = getPlayerDisplayName(playersById.get(a.player_id));
        const playerB = getPlayerDisplayName(playersById.get(b.player_id));
        return playerA.localeCompare(playerB);
      });
    });
    return map;
  }, [predictions, playersById]);

  const publishedMatches = matches.filter((match) => match.is_published);
  const participationRows = publishedMatches.map((match) => {
    const matchPredictions = predictionsByMatch.get(match.id) || [];
    const activePredictionCount = matchPredictions.filter((prediction) =>
      isPlayerActive(playersById.get(prediction.player_id)),
    ).length;
    return {
      match,
      activePredictionCount,
      totalActivePlayers: activePlayerCount,
      percent: activePlayerCount ? Math.round((activePredictionCount / activePlayerCount) * 100) : 0,
    };
  });

  return (
    <section>
      <PageTitle title="Picks" action={<button onClick={refresh}>Refresh</button>} />
      {publishedMatches.length > 0 && (
        <div className="picks-dashboard">
          <h2>Prediction Dashboard</h2>
          <div className="dashboard-grid">
            {participationRows.map(({ match, activePredictionCount, totalActivePlayers, percent }) => (
              <article className="dashboard-item" key={match.id}>
                <div>
                  <strong>{match.team_a} vs {match.team_b}</strong>
                  <span>{match.group_name || match.stage || 'Match'} · {formatDate(match.kickoff_time)}</span>
                </div>
                <div className="prediction-count">
                  <strong>{activePredictionCount}</strong>
                  <span>/ {totalActivePlayers} players</span>
                </div>
                <div className="progress-track" aria-label={`${percent}% submitted`}>
                  <span style={{ width: `${percent}%` }} />
                </div>
              </article>
            ))}
          </div>
        </div>
      )}
      <div className="match-list">
        {publishedMatches.map((match) => {
          const matchPredictions = predictionsByMatch.get(match.id) || [];
          const canReveal = isMatchLocked(match);
          const activeSubmittedCount = matchPredictions.filter((prediction) =>
            isPlayerActive(playersById.get(prediction.player_id)),
          ).length;
          return (
            <article className="match-card" key={match.id}>
              <div className="match-meta">
                <span>{match.stage || 'Match'}</span>
                {match.group_name && <span>{match.group_name}</span>}
                <span>{formatDate(match.kickoff_time)}</span>
              </div>
              <div className="teams">
                <strong>{match.team_a}</strong>
                <span>vs</span>
                <strong>{match.team_b}</strong>
              </div>
              <p className="muted">{activeSubmittedCount} of {activePlayerCount} active players submitted.</p>
              {!canReveal && (
                <p className="muted">
                  Score picks stay hidden until kickoff or when the admin locks this match.
                </p>
              )}
              {matchPredictions.length > 0 && (
                <div className="table-wrap compact-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Player</th>
                        <th>Pick</th>
                        <th>Submitted</th>
                      </tr>
                    </thead>
                    <tbody>
                      {matchPredictions.map((prediction) => (
                        <tr key={prediction.id}>
                          <td>{getPlayerDisplayName(playersById.get(prediction.player_id))}</td>
                          <td>
                            {canReveal
                              ? `${prediction.predicted_team_a_score} - ${prediction.predicted_team_b_score}`
                              : 'Hidden until kickoff'}
                          </td>
                          <td>{formatDate(prediction.submitted_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {matchPredictions.length === 0 && (
                <p className="muted">No picks submitted for this match yet.</p>
              )}
            </article>
          );
        })}
      </div>
      {!publishedMatches.length && <EmptyState text="No published matches yet." />}
    </section>
  );
}

function AdminPage(props) {
  const [unlocked, setUnlocked] = useState(sessionStorage.getItem('admin-ok') === 'yes');
  const [password, setPassword] = useState('');

  if (!unlocked) {
    return (
      <section className="admin-login">
        <h1>Admin</h1>
        <p className="muted">Enter the private group admin password.</p>
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Admin password"
        />
        <button
          className="primary"
          onClick={() => {
            if (ADMIN_PASSWORD && password === ADMIN_PASSWORD) {
              sessionStorage.setItem('admin-ok', 'yes');
              setUnlocked(true);
            } else {
              props.setError('Wrong admin password, or VITE_ADMIN_PASSWORD is not configured.');
            }
          }}
        >
          Unlock admin
        </button>
      </section>
    );
  }

  return <AdminTools {...props} />;
}

function AdminTools({ matches, refresh, setMessage, setError, tournament }) {
  const blank = {
    external_match_id: '',
    stage: 'Group Stage',
    group_name: '',
    team_a: '',
    team_b: '',
    kickoff_time: '',
    venue: '',
    status: 'scheduled',
    is_locked: false,
    is_published: true,
    team_a_score: '',
    team_b_score: '',
  };
  const [form, setForm] = useState(blank);
  const [editingId, setEditingId] = useState('');
  const [csvText, setCsvText] = useState('');
  const [jsonUrl, setJsonUrl] = useState('');
  const [jsonText, setJsonText] = useState('');

  const setField = (field, value) => setForm((current) => ({ ...current, [field]: value }));

  const edit = (match) => {
    setEditingId(match.id);
    setForm({
      ...match,
      kickoff_time: toLocalInputValue(match.kickoff_time),
      team_a_score: match.team_a_score ?? '',
      team_b_score: match.team_b_score ?? '',
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const reset = () => {
    setEditingId('');
    setForm(blank);
  };

  const save = async () => {
    setMessage('');
    setError('');
    const scoreA = form.team_a_score === '' ? null : parseScore(form.team_a_score);
    const scoreB = form.team_b_score === '' ? null : parseScore(form.team_b_score);
    if (!form.team_a.trim() || !form.team_b.trim() || !form.kickoff_time) {
      setError('Team names and kickoff time are required.');
      return;
    }
    if ((form.team_a_score !== '' && scoreA === null) || (form.team_b_score !== '' && scoreB === null)) {
      setError('Final scores must be non-negative whole numbers.');
      return;
    }
    try {
      const payload = {
        ...((form.tournament_id || tournament?.id) ? { tournament_id: form.tournament_id || tournament.id } : {}),
        external_match_id: form.external_match_id.trim() || null,
        stage: form.stage.trim() || null,
        group_name: form.group_name.trim() || null,
        team_a: form.team_a.trim(),
        team_b: form.team_b.trim(),
        kickoff_time: new Date(form.kickoff_time).toISOString(),
        venue: form.venue.trim() || null,
        status: form.status,
        is_locked: Boolean(form.is_locked),
        is_published: Boolean(form.is_published),
        team_a_score: scoreA,
        team_b_score: scoreB,
        updated_at: new Date().toISOString(),
      };
      const response = editingId
        ? await supabase.from('matches').update(payload).eq('id', editingId)
        : await supabase.from('matches').insert(payload);
      throwIfError(response.error);
      setMessage(editingId ? 'Match updated.' : 'Match added.');
      reset();
      await refresh();
    } catch (err) {
      setError(err.message || 'Could not save match.');
    }
  };

  const remove = async (match) => {
    if (!confirm(`Delete ${match.team_a} vs ${match.team_b}?`)) return;
    setMessage('');
    setError('');
    try {
      const { error } = await supabase.from('matches').delete().eq('id', match.id);
      throwIfError(error);
      setMessage('Match deleted.');
      await refresh();
    } catch (err) {
      setError(err.message || 'Could not delete match.');
    }
  };

  const quickUpdate = async (id, patch) => {
    setMessage('');
    setError('');
    try {
      const { data, error } = await supabase
        .from('matches')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();
      throwIfError(error);
      const lockReason = patch.is_locked === false ? getMatchLockReason(data) : '';
      setMessage(lockReason ? `Manual lock removed. ${lockReason}` : 'Match updated.');
      await refresh();
    } catch (err) {
      setError(err.message || 'Could not update match.');
    }
  };

  const importFixtures = async (source) => {
    setMessage('');
    setError('');
    try {
      let rows = [];
      if (source === 'csv') {
        rows = parseFixtureCsv(csvText);
      }
      if (source === 'json-text') {
        rows = parseFixtureJson(jsonText);
      }
      if (source === 'json-url') {
        const response = await fetch(jsonUrl);
        if (!response.ok) throw new Error(`Fixture URL failed with ${response.status}.`);
        rows = parseFixtureJson(await response.text());
      }
      const fixtures = normalizeFixtureRows(rows).map((fixture) => ({
        ...fixture,
        ...(tournament?.id ? { tournament_id: tournament.id } : {}),
      }));
      if (!fixtures.length) throw new Error('No valid fixtures found.');
      const { error } = await supabase.from('matches').upsert(fixtures, { onConflict: 'external_match_id' });
      throwIfError(error);
      setMessage(`Imported ${fixtures.length} fixture${fixtures.length === 1 ? '' : 's'}.`);
      await refresh();
    } catch (err) {
      setError(err.message || 'Could not import fixtures.');
    }
  };

  return (
    <section>
      <PageTitle title="Admin" action={<button onClick={refresh}>Refresh</button>} />
      <div className="admin-grid">
        <div className="panel">
          <h2>{editingId ? 'Edit match' : 'Add match'}</h2>
          <AdminInput label="External match ID" value={form.external_match_id || ''} onChange={(value) => setField('external_match_id', value)} />
          <div className="two-col">
            <AdminInput label="Team A" value={form.team_a} onChange={(value) => setField('team_a', value)} />
            <AdminInput label="Team B" value={form.team_b} onChange={(value) => setField('team_b', value)} />
          </div>
          <AdminInput label="Kickoff time" type="datetime-local" value={form.kickoff_time} onChange={(value) => setField('kickoff_time', value)} />
          <div className="two-col">
            <AdminInput label="Stage" value={form.stage || ''} onChange={(value) => setField('stage', value)} />
            <AdminInput label="Group" value={form.group_name || ''} onChange={(value) => setField('group_name', value)} />
          </div>
          <AdminInput label="Venue" value={form.venue || ''} onChange={(value) => setField('venue', value)} />
          <label>
            Status
            <select value={form.status} onChange={(event) => setField('status', event.target.value)}>
              {STATUSES.map((status) => <option key={status}>{status}</option>)}
            </select>
          </label>
          <div className="two-col">
            <AdminInput label="Team A final score" type="number" value={form.team_a_score} onChange={(value) => setField('team_a_score', value)} />
            <AdminInput label="Team B final score" type="number" value={form.team_b_score} onChange={(value) => setField('team_b_score', value)} />
          </div>
          <div className="toggle-row">
            <label><input type="checkbox" checked={form.is_published} onChange={(event) => setField('is_published', event.target.checked)} /> Published</label>
            <label><input type="checkbox" checked={form.is_locked} onChange={(event) => setField('is_locked', event.target.checked)} /> Locked</label>
          </div>
          <div className="button-row">
            <button className="primary" onClick={save}>{editingId ? 'Save changes' : 'Add match'}</button>
            {editingId && <button onClick={reset}>Cancel</button>}
          </div>
        </div>

        <div className="panel">
          <h2>Import / Refresh Fixtures</h2>
          <label>
            Public JSON URL
            <input value={jsonUrl} onChange={(event) => setJsonUrl(event.target.value)} placeholder="https://example.com/fixtures.json" />
          </label>
          <button onClick={() => importFixtures('json-url')}>Import JSON URL</button>
          <label>
            Paste JSON
            <textarea value={jsonText} onChange={(event) => setJsonText(event.target.value)} rows="6" placeholder='[{"match_id":"m1","team_a":"Team A","team_b":"Team B","kickoff_time":"2026-06-11T19:00:00Z"}]' />
          </label>
          <button onClick={() => importFixtures('json-text')}>Import pasted JSON</button>
          <label>
            Paste CSV
            <textarea value={csvText} onChange={(event) => setCsvText(event.target.value)} rows="8" placeholder="match_id,stage,group_name,team_a,team_b,kickoff_time,venue" />
          </label>
          <button onClick={() => importFixtures('csv')}>Import pasted CSV</button>
        </div>
      </div>

      <div className="admin-list">
        {matches.map((match) => (
          <article className="admin-match" key={match.id}>
            <div>
              <strong>{match.team_a} vs {match.team_b}</strong>
              <p>{formatDate(match.kickoff_time)} · {match.stage || 'Match'} {match.group_name ? `· ${match.group_name}` : ''}</p>
              <p>
                {match.status} · {match.is_published ? 'published' : 'hidden'} · manual lock {match.is_locked ? 'on' : 'off'}
                {isFinalScoreComplete(match) ? ` · final ${match.team_a_score}-${match.team_b_score}` : ''}
                {getLiveScore(match) ? ` · live ${getLiveScore(match)}` : ''}
              </p>
              {(match.live_source || match.last_synced_at || match.live_status_note) && (
                <p>
                  {match.live_source || 'Live source'}
                  {match.live_minute !== null && match.live_minute !== undefined ? ` · ${match.live_minute}'` : ''}
                  {match.live_status_note ? ` · ${match.live_status_note}` : ''}
                  {match.last_synced_at ? ` · synced ${formatDate(match.last_synced_at)}` : ''}
                </p>
              )}
              <p>{getMatchLockReason(match) || 'Predictions are open.'}</p>
            </div>
            <div className="admin-actions">
              <button onClick={() => edit(match)}>Edit</button>
              <button onClick={() => quickUpdate(match.id, { is_published: !match.is_published })}>{match.is_published ? 'Unpublish' : 'Publish'}</button>
              <button onClick={() => quickUpdate(match.id, { is_locked: !match.is_locked })}>{match.is_locked ? 'Unlock' : 'Lock'}</button>
              <button className="danger" onClick={() => remove(match)}>Delete</button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function AdminInput({ label, value, onChange, type = 'text' }) {
  return (
    <label>
      {label}
      <input type={type} min="0" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function PageTitle({ title, action }) {
  return (
    <div className="page-title">
      <h1>{title}</h1>
      {action}
    </div>
  );
}

function NeedPlayer({ navigate }) {
  return (
    <div className="panel centered">
      <h1>Enter your name first</h1>
      <p className="muted">Your profile lets the app save predictions to the shared leaderboard.</p>
      <button className="primary" onClick={() => navigate('/')}>Go to welcome page</button>
    </div>
  );
}

function InactivePlayer({ navigate }) {
  return (
    <div className="panel centered">
      <h1>Profile inactive</h1>
      <p className="muted">This duplicate profile was deactivated. Use the active profile for this display name.</p>
      <button className="primary" onClick={() => navigate('/')}>Go to welcome page</button>
    </div>
  );
}

function EmptyState({ text }) {
  return <p className="empty">{text}</p>;
}

function useRoute() {
  const normalize = () => {
    const path = window.location.pathname;
    return ['/', '/matches', '/predictions', '/leaderboard', '/admin'].includes(path) ? path : '/';
  };
  const [route, setRoute] = useState(normalize);
  useEffect(() => {
    const onPopState = () => setRoute(normalize());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
  return [route, setRoute];
}

function useStoredPlayer() {
  const [player, setPlayerState] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('current-player') || 'null');
    } catch {
      return null;
    }
  });
  const setPlayer = (value) => {
    setPlayerState(value);
    if (value) localStorage.setItem('current-player', JSON.stringify(value));
    else localStorage.removeItem('current-player');
  };
  return [player, setPlayer];
}

function parseScore(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function getLiveScore(match) {
  const scoreA = match.live_team_a_score ?? (match.status === 'live' ? match.team_a_score : null);
  const scoreB = match.live_team_b_score ?? (match.status === 'live' ? match.team_b_score : null);
  if (scoreA === null || scoreA === undefined || scoreB === null || scoreB === undefined) return '';
  return `${scoreA} - ${scoreB}`;
}

function rowsForMatch(rows, matchId) {
  return rows.filter((row) => row.match_id === matchId);
}

function toLocalInputValue(value) {
  if (!value) return '';
  const date = new Date(value);
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return offsetDate.toISOString().slice(0, 16);
}

function throwIfError(error) {
  if (error) throw error;
}

function formatPublicSource(source) {
  if (/api/i.test(String(source || ''))) return 'Live data';
  return source;
}

function formatAidTitle(aid) {
  if (aid.aid_type === 'api_prediction' || /api prediction/i.test(aid.title || '')) {
    return 'Prediction outlook';
  }
  if (aid.aid_type === 'head_to_head') return 'Recent meetings';
  if (aid.aid_type === 'injuries') return 'Team news';
  return aid.title;
}

function formatAidSummary(summary, oddsInsight) {
  const value = String(summary || '').trim();
  if (!value) return 'Data available.';
  if (/^no predictions available$/i.test(value)) return 'No clear prediction is available yet.';
  const doubleChance = value.match(/^double chance\s*:\s*(.+)$/i);
  if (doubleChance) {
    const advice = formatSentenceFragment(doubleChance[1]);
    if (oddsInsight?.favoriteLabel && !containsTeamName(advice, oddsInsight.favoriteLabel)) {
      return `Different signal: the prediction model suggests ${advice}, while the odds favor ${oddsInsight.favoriteLabel}.`;
    }
    return `Prediction model suggests ${advice}.`;
  }
  return formatSentenceFragment(value);
}

function containsTeamName(value, teamName) {
  return String(value || '').toLowerCase().includes(String(teamName || '').toLowerCase());
}

function formatMarketName(market) {
  if (/^match winner$/i.test(String(market || ''))) return 'Winner odds';
  return formatSentenceFragment(market || 'Match odds');
}

function formatEventType(type) {
  const value = String(type || '').trim();
  if (/^subst$/i.test(value) || /substitution/i.test(value)) return 'Substitution';
  if (/^var$/i.test(value)) return 'Video review';
  return formatSentenceFragment(value || 'Event');
}

function formatEventDetail(detail) {
  const value = String(detail || '').trim();
  if (/normal goal/i.test(value)) return 'Goal';
  if (/own goal/i.test(value)) return 'Own goal';
  if (/penalty/i.test(value) && /missed/i.test(value)) return 'Missed penalty';
  if (/penalty/i.test(value)) return 'Penalty';
  if (/yellow card/i.test(value)) return 'Yellow card';
  if (/red card/i.test(value)) return 'Red card';
  return formatSentenceFragment(value);
}

function formatSentenceFragment(value) {
  const cleaned = String(value || '')
    .replace(/\s+:\s+/g, ': ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

async function optionalSelect(query) {
  const result = await query;
  if (isMissingOptionalRelation(result.error)) return { data: [], error: null };
  return result;
}

function isMissingOptionalRelation(error) {
  if (!error) return false;
  return error.code === 'PGRST205' ||
    error.code === '42P01' ||
    /could not find the table|schema cache|does not exist/i.test(error.message || '');
}

function normalizePlayerName(value) {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function isPlayerActive(player) {
  return player?.is_active !== false;
}

function getPlayerDisplayName(player) {
  if (!player) return 'Unknown player';
  return isPlayerActive(player) ? player.name : `${player.name} (inactive)`;
}

function isUniqueViolation(error) {
  return error?.code === '23505' || /duplicate key|unique/i.test(error?.message || '');
}

createRoot(document.getElementById('root')).render(<App />);
