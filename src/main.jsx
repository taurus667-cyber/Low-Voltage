import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { supabase, isSupabaseConfigured } from './lib/supabase.js';
import { calculateLeaderboard, isFinalScoreComplete, predictionPoints } from './lib/scoring.js';
import { calculateLiveLeaderboard, livePredictionPoints } from './lib/livePoints.js';
import { getActiveTournament, getTournamentBySlug, scopedRows } from './lib/tournament.js';
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
import { calculateGroupStandings, getTeamStanding } from './lib/standings.js';
import { getMatchesRefreshInterval } from './lib/polling.js';
import { normalizeName, teamIdentity, slugifyTeamName } from './lib/teamMetadata.js';
import { splitMatchEvents } from './lib/matchEvents.js';
import './styles.css';

const ADMIN_PASSWORD = import.meta.env.VITE_ADMIN_PASSWORD || '';
const STATUSES = ['scheduled', 'live', 'finished'];

function App() {
  const [route, setRoute] = useRoute();
  const pageRoute = getPageRoute(route);
  const groupSlug = getRouteGroupSlug(route);
  const routeBase = groupSlug ? `/g/${groupSlug}` : '';
  const [player, setPlayer] = useStoredPlayer();
  const [players, setPlayers] = useState([]);
  const [matches, setMatches] = useState([]);
  const [predictions, setPredictions] = useState([]);
  const [tournaments, setTournaments] = useState([]);
  const [teams, setTeams] = useState([]);
  const [teamFavorites, setTeamFavorites] = useState([]);
  const [matchEvents, setMatchEvents] = useState([]);
  const [matchStatistics, setMatchStatistics] = useState([]);
  const [matchLineups, setMatchLineups] = useState([]);
  const [predictionAids, setPredictionAids] = useState([]);
  const [matchOdds, setMatchOdds] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    setLoading(true);
    setError('');
    try {
      const [tournamentRows, playerRows, matchRows, predictionRows, teamRows, favoriteRows, aidRows, oddsRows] = await Promise.all([
        optionalSelect(supabase.from('tournaments').select('*').order('created_at')),
        supabase.from('players').select('*').order('created_at'),
        supabase.from('matches').select('*').order('kickoff_time'),
        supabase.from('predictions').select('*').order('submitted_at'),
        optionalSelect(supabase.from('teams').select('*').order('name')),
        optionalSelect(supabase.from('player_favorite_teams').select('*').order('created_at')),
        optionalSelect(supabase.from('match_prediction_aids').select('*').order('aid_type')),
        optionalSelect(supabase.from('match_odds').select('*')),
      ]);
      throwIfError(playerRows.error);
      throwIfError(matchRows.error);
      throwIfError(predictionRows.error);
      const loadedMatches = matchRows.data || [];
      const currentPageRoute = getPageRoute(route);
      const needsMatchDetails = currentPageRoute === '/matches' || currentPageRoute.startsWith('/nations/');
      const hasLiveMatches = loadedMatches.some((match) => isMatchLive(match));
      const [eventRows, statisticRows, lineupRows] = hasLiveMatches
        || needsMatchDetails
        ? await Promise.all([
            optionalSelect(supabase.from('match_events').select('*').order('elapsed')),
            optionalSelect(supabase.from('match_statistics').select('*')),
            optionalSelect(supabase.from('match_lineups').select('*')),
          ])
        : [{ data: [] }, { data: [] }, { data: [] }];
      setTournaments(tournamentRows.data || []);
      setPlayers(playerRows.data || []);
      setMatches(loadedMatches);
      setPredictions(predictionRows.data || []);
      setTeams(teamRows.data || []);
      setTeamFavorites(favoriteRows.data || []);
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
  }, [route]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const navigate = (nextRoute) => {
    window.history.pushState({}, '', nextRoute);
    setRoute(normalizeRoute(nextRoute));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const activeTournament = getTournamentBySlug(tournaments, groupSlug) || getActiveTournament(tournaments);
  const scopedPlayers = scopedRows(players, activeTournament);
  const scopedMatches = scopedRows(matches, activeTournament);
  const scopedPredictions = scopedRows(predictions, activeTournament);
  const scopedTeams = scopedRows(teams, activeTournament);
  const scopedTeamFavorites = scopedRows(teamFavorites, activeTournament);
  const currentScopedPlayer = scopedPlayers.find((item) => item.id === player?.id) || null;

  const toggleTeamFavorite = async (team) => {
    setMessage('');
    setError('');
    if (!currentScopedPlayer || !isPlayerActive(currentScopedPlayer)) {
      setError('Choose your player profile before adding favorites.');
      return;
    }
    if (!team?.slug) return;
    const existing = scopedTeamFavorites.find((favorite) =>
      favorite.player_id === currentScopedPlayer.id && favorite.team_slug === team.slug,
    );
    try {
      if (existing) {
        const { error } = await supabase.from('player_favorite_teams').delete().eq('id', existing.id);
        throwIfError(error);
        setMessage(`${team.name} removed from favorites.`);
      } else {
        const { error } = await supabase.from('player_favorite_teams').insert({
          tournament_id: activeTournament?.id || null,
          player_id: currentScopedPlayer.id,
          team_slug: team.slug,
          team_name: team.name,
          country_code: team.country_code || null,
          flag_url: team.flag_url || null,
        });
        throwIfError(error);
        setMessage(`${team.name} added to favorites.`);
      }
      await refresh();
    } catch (err) {
      setError(err.message || 'Could not update favorite team.');
    }
  };

  const pageProps = {
    player: currentScopedPlayer,
    setPlayer,
    players: scopedPlayers,
    matches: scopedMatches,
    predictions: scopedPredictions,
    teams: scopedTeams,
    teamFavorites: scopedTeamFavorites,
    toggleTeamFavorite,
    tournament: activeTournament,
    tournaments,
    sourceTournaments: tournaments.filter((tournament) => !tournament.is_clone),
    allPlayers: players,
    allMatches: matches,
    allPredictions: predictions,
    allTeamFavorites: teamFavorites,
    routeBase,
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
        <button className="brand" onClick={() => navigate(buildRoute(routeBase, '/'))}>
          {activeTournament.name} Picks
        </button>
        <nav aria-label="Primary navigation">
          <button className={pageRoute === '/matches' ? 'active' : ''} onClick={() => navigate(buildRoute(routeBase, '/matches'))}>
            Matches
          </button>
          <button className={pageRoute === '/predictions' ? 'active' : ''} onClick={() => navigate(buildRoute(routeBase, '/predictions'))}>
            Picks
          </button>
          <button className={pageRoute === '/groups' ? 'active' : ''} onClick={() => navigate(buildRoute(routeBase, '/groups'))}>
            Groups
          </button>
          <button className={pageRoute === '/favorites' ? 'active' : ''} onClick={() => navigate(buildRoute(routeBase, '/favorites'))}>
            Favorites
          </button>
          <button className={pageRoute === '/leaderboard' ? 'active' : ''} onClick={() => navigate(buildRoute(routeBase, '/leaderboard'))}>
            Leaderboard
          </button>
          <button className={pageRoute === '/admin' ? 'active' : ''} onClick={() => navigate(buildRoute(routeBase, '/admin'))}>
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
        {pageRoute === '/' && <HomePage {...pageProps} />}
        {pageRoute === '/matches' && <MatchesPage {...pageProps} />}
        {pageRoute === '/predictions' && <PredictionsPage {...pageProps} />}
        {pageRoute === '/groups' && <GroupsPage {...pageProps} />}
        {pageRoute === '/favorites' && <FavoritesPage {...pageProps} />}
        {pageRoute.startsWith('/nations/') && <NationPage {...pageProps} route={pageRoute} />}
        {pageRoute === '/leaderboard' && <LeaderboardPage {...pageProps} />}
        {pageRoute === '/admin' && <AdminPage {...pageProps} />}
      </main>
    </div>
  );
}

function HomePage({ player, setPlayer, players, refresh, setMessage, setError, navigate, tournament, routeBase }) {
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
        navigate(buildRoute(routeBase, '/matches'));
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
      navigate(buildRoute(routeBase, '/matches'));
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
          <button className="ghost" onClick={() => navigate(buildRoute(routeBase, '/matches'))}>
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
  teams,
  predictions,
  refresh,
  loading,
  setMessage,
  setError,
  navigate,
  routeBase,
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
  const refreshInterval = getMatchesRefreshInterval(publishedMatches);

  useEffect(() => {
    if (!currentPlayer || !isPlayerActive(currentPlayer)) return undefined;
    if (!refreshInterval) return undefined;
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, refreshInterval);
    return () => window.clearInterval(intervalId);
  }, [currentPlayer, refresh, refreshInterval]);

  useEffect(() => {
    const targetId = window.location.hash.replace('#match-', '');
    if (!targetId) return;
    const targetMatch = publishedMatches.find((match) => match.id === targetId);
    if (targetMatch && isMatchPlayed(targetMatch)) setMatchView('played');
    window.setTimeout(() => {
      document.getElementById(`match-${targetId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 50);
  }, [publishedMatches]);

  if (!currentPlayer) {
    return <NeedPlayer navigate={navigate} routeBase={routeBase} />;
  }
  if (!isPlayerActive(currentPlayer)) {
    return <InactivePlayer navigate={navigate} routeBase={routeBase} />;
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
                teams={teams}
                navigate={navigate}
                routeBase={routeBase}
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
            teams={teams}
            navigate={navigate}
            routeBase={routeBase}
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
  teams = [],
  navigate,
  routeBase,
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
  const teamA = teamIdentity(match.team_a, teams);
  const teamB = teamIdentity(match.team_b, teams);
  const played = isMatchPlayed(match);

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
    <article id={`match-${match.id}`} className={`match-card${live ? ' live-card' : ''}`}>
      <div className="match-meta">
        <span>{match.stage || 'Match'}</span>
        {match.group_name && <span>{match.group_name}</span>}
        <span>{formatDate(match.kickoff_time)}</span>
        {live && <span className="live-pill">{getLiveStatusLabel(match)}</span>}
      </div>
      <div className="teams">
        <TeamBlock team={teamA} align="start" navigate={navigate} routeBase={routeBase} />
        <span>vs</span>
        <TeamBlock team={teamB} align="end" navigate={navigate} routeBase={routeBase} />
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
      {!live && played && (
        <MatchCentre
          match={match}
          teams={teams}
          events={events}
          statistics={statistics}
          lineups={lineups}
          aids={aids}
          odds={odds}
          insightItemCount={aids.length + odds.length}
          currentPredictionPoints={null}
          livePoints={livePoints}
          title="Match recap"
          open={false}
          showLivePoints={false}
          emptyText="No captured live stats are available for this match yet."
        />
      )}
      {!live && !played && (
        <PredictionAid match={match} teams={teams} aids={aids} odds={odds} lineups={lineups} itemCount={aidItemCount} />
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

function TeamBlock({ team, align = 'start', navigate, routeBase = '' }) {
  const openNation = () => {
    if (team?.slug && navigate) navigate(buildRoute(routeBase, `/nations/${team.slug}`));
  };
  return (
    <button className={`team-block ${align}`} onClick={openNation} disabled={!team?.slug} title={`Open ${team.name} profile`}>
      <TeamFlag team={team} />
      <span>
        <strong>{team.name}</strong>
      </span>
    </button>
  );
}

function TeamFlag({ team }) {
  if (!team?.flag_url) return <span className="flag-placeholder" aria-hidden="true">{(team?.name || '?').slice(0, 2).toUpperCase()}</span>;
  return <img className="team-flag" src={team.flag_url} alt={`${team.name} flag`} loading="lazy" />;
}

function FavoriteTeamButton({ team, isFavorite, onToggle, player }) {
  const label = isFavorite ? `Remove ${team.name} from favorites` : `Add ${team.name} to favorites`;
  return (
    <button
      className={`favorite-button${isFavorite ? ' active' : ''}`}
      onClick={(event) => {
        event.stopPropagation();
        onToggle?.(team);
      }}
      disabled={!player || !team?.slug}
      title={!player ? 'Choose your player profile first' : label}
      aria-label={label}
    >
      {isFavorite ? '★' : '☆'}
    </button>
  );
}

function isFavoriteTeam(team, favorites = [], player) {
  if (!team?.slug || !player) return false;
  return favorites.some((favorite) => favorite.player_id === player.id && favorite.team_slug === team.slug);
}

function MatchCentre({
  match,
  teams = [],
  events,
  statistics,
  lineups,
  aids = [],
  odds = [],
  insightItemCount = 0,
  currentPredictionPoints,
  livePoints,
  title = 'Match centre',
  open = true,
  showLivePoints = true,
  emptyText = 'Live event details will appear when the provider publishes them.',
}) {
  const { keyEvents, goalEvents } = splitMatchEvents(events);
  const statComparison = buildStatComparison(statistics);
  const hasPredictionInsight = aids.length > 0 || odds.length > 0;
  const insightSummary = match && hasPredictionInsight ? buildPredictionAidSummary({ match, teams, aids, odds, lineups }) : null;

  return (
    <details className="match-centre" open={open}>
      <summary>
        <span>{title}</span>
        {insightItemCount > 0 && <span className="insight-badge">{insightItemCount} insight item{insightItemCount === 1 ? '' : 's'}</span>}
        {insightSummary?.oddsInsight?.favoriteLabel && (
          <span className="summary-favorite">
            {insightSummary.oddsInsight.favoriteTeam && <TeamFlag team={insightSummary.oddsInsight.favoriteTeam} />}
            Favored: {insightSummary.oddsInsight.favoriteLabel}
          </span>
        )}
        {insightSummary?.latestSyncedAt && <span className="aid-caption">Updated {formatRelativeTime(insightSummary.latestSyncedAt)}</span>}
      </summary>
      {showLivePoints && (
        <div className="live-points-row">
          <span>This pick now: {currentPredictionPoints === null ? 'n/a' : `${currentPredictionPoints} pts`}</span>
          <span>Your live total: {livePoints} pts</span>
        </div>
      )}
      {lineups.length > 0 && (
        <div className="lineup-row">
          {lineups.map((lineup) => (
            <span key={lineup.id}>{lineup.team_name} {lineup.formation ? `(${lineup.formation})` : ''}</span>
          ))}
        </div>
      )}
      {statComparison.rows.length > 0 && (
        <div className="stats-table-wrap">
          <strong>Match stats</strong>
          <table className="stats-table">
            <thead>
              <tr>
                <th>{statComparison.teams[0] || 'Team A'}</th>
                <th>Stat</th>
                <th>{statComparison.teams[1] || 'Team B'}</th>
              </tr>
            </thead>
            <tbody>
              {statComparison.rows.map((row) => (
                <tr key={row.label}>
                  <td>{formatStatValue(row.values[0])}</td>
                  <th scope="row">{formatStatLabel(row.label)}</th>
                  <td>{formatStatValue(row.values[1])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {keyEvents.length > 0 && (
        <div className="event-group">
          <strong>Key events</strong>
          <div className="event-list">
            {keyEvents.map((event) => <EventChip key={event.id} event={event} teams={teams} />)}
          </div>
        </div>
      )}
      {goalEvents.length > 0 && (
        <div className="event-group">
          <strong>Goals</strong>
          <div className="event-list">
            {goalEvents.map((event) => <EventChip key={event.id} event={event} teams={teams} />)}
          </div>
        </div>
      )}
      {insightSummary && (
        <PredictionAidContent
          match={match}
          aids={aids}
          odds={odds}
          lineups={lineups}
          summary={insightSummary}
          showLineups={false}
        />
      )}
      {!events.length && !statistics.length && !lineups.length && (
        <p className="muted">{emptyText}</p>
      )}
    </details>
  );
}

function buildStatComparison(statistics) {
  const teams = statistics.map((row) => row.team_name).filter(Boolean).slice(0, 2);
  const labels = [];
  const valuesByTeam = new Map();
  statistics.slice(0, 2).forEach((teamRow) => {
    const teamValues = new Map();
    Object.entries(teamRow.statistics || {}).forEach(([label, value]) => {
      if (value === null || value === undefined || value === '') return;
      if (!labels.includes(label)) labels.push(label);
      teamValues.set(label, value);
    });
    valuesByTeam.set(teamRow.team_name, teamValues);
  });
  const priority = [
    'Ball Possession',
    'Total Shots',
    'Shots on Goal',
    'Corner Kicks',
    'Fouls',
    'Offsides',
    'Yellow Cards',
    'Red Cards',
    'Passes %',
  ];
  const orderedLabels = labels
    .sort((a, b) => {
      const aIndex = priority.indexOf(a);
      const bIndex = priority.indexOf(b);
      if (aIndex !== -1 || bIndex !== -1) {
        return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
      }
      return a.localeCompare(b);
    })
    .slice(0, 9);
  return {
    teams,
    rows: orderedLabels.map((label) => ({
      label,
      values: teams.map((team) => valuesByTeam.get(team)?.get(label)),
    })),
  };
}

function PredictionAid({ match, teams = [], aids, odds, lineups, itemCount }) {
  const summary = buildPredictionAidSummary({ match, teams, aids, odds, lineups });
  if (!itemCount) {
    return (
      <div className="prediction-aid-status">
        <div>
          <strong>Match insight</strong>
          <span>Waiting for match data for this game.</span>
        </div>
      </div>
    );
  }
  return (
    <details className="prediction-aid">
      <summary>
        <span>Match insight</span>
        <span className="insight-badge">{itemCount} item{itemCount === 1 ? '' : 's'}</span>
        {summary.oddsInsight?.favoriteLabel && (
          <span className="summary-favorite">
            {summary.oddsInsight.favoriteTeam && <TeamFlag team={summary.oddsInsight.favoriteTeam} />}
            Favored: {summary.oddsInsight.favoriteLabel}
          </span>
        )}
        {summary.latestSyncedAt && <span className="aid-caption">Updated {formatRelativeTime(summary.latestSyncedAt)}</span>}
      </summary>
      <PredictionAidContent match={match} aids={aids} odds={odds} lineups={lineups} summary={summary} />
    </details>
  );
}

function buildPredictionAidSummary({ match, teams = [], aids = [], odds = [], lineups = [] }) {
  const teamA = teamIdentity(match.team_a, teams);
  const teamB = teamIdentity(match.team_b, teams);
  return {
    teamA,
    teamB,
    oddsInsight: buildOddsInsight(odds, match, { teamA, teamB }),
    latestSyncedAt: latestTimestamp([
      ...aids.map((aid) => aid.last_synced_at),
      ...odds.map((odd) => odd.last_synced_at),
      ...lineups.map((lineup) => lineup.last_synced_at),
    ]),
  };
}

function PredictionAidContent({ match, aids, odds, lineups, summary, showLineups = true }) {
  const displayedLineups = showLineups ? lineups : [];
  return (
    <>
      {summary.oddsInsight && (
        <div className="odds-summary">
          <strong>Market view</strong>
          <span>
            {summary.oddsInsight.favoriteTeam && <TeamFlag team={summary.oddsInsight.favoriteTeam} />}
            {summary.oddsInsight.favoriteLabel} is favored by the available odds.
          </span>
          {summary.oddsInsight.syncedAt && <small>Odds synced {formatDate(summary.oddsInsight.syncedAt)}</small>}
        </div>
      )}
      <div className="aid-grid">
        {odds.slice(0, 3).map((odd) => (
          <article key={odd.id} className="odds-card">
            <strong>{odd.bookmaker || 'Bookmaker odds'}</strong>
            <span className="aid-caption">{formatMarketName(odd.market)}</span>
            <div className="odds-options">
              {buildOddsOptions(odd, match, { teamA: summary.teamA, teamB: summary.teamB }).map((option) => (
                <span key={option.key} className={option.isFavorite ? 'favorite' : ''}>
                  <small>
                    {option.team && <TeamFlag team={option.team} />}
                    {option.label}
                  </small>
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
            <span>{formatAidSummary(aid.summary, summary.oddsInsight)}</span>
            {aid.last_synced_at && <small>Synced {formatDate(aid.last_synced_at)}</small>}
          </article>
        ))}
        {displayedLineups.map((lineup) => (
          <article key={lineup.id}>
            <strong>{lineup.team_name} lineup</strong>
            <span>{lineup.formation || 'Formation pending'}</span>
            {lineup.last_synced_at && <small>Synced {formatDate(lineup.last_synced_at)}</small>}
          </article>
        ))}
      </div>
    </>
  );
}

function buildOddsInsight(odds, match, teams = {}) {
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
  const favoriteTeam = {
    home: teams.teamA,
    away: teams.teamB,
  };
  return {
    favoriteLabel: labels[favoriteKey] || 'A team',
    favoriteTeam: favoriteTeam[favoriteKey] || null,
    syncedAt: rows.map((row) => row.syncedAt).filter(Boolean).sort().at(-1),
  };
}

function buildOddsOptions(odd, match, teams = {}) {
  const options = [
    { key: 'home', label: `${match.team_a} win`, value: odd.home_value, team: teams.teamA },
    { key: 'draw', label: 'Draw', value: odd.draw_value },
    { key: 'away', label: `${match.team_b} win`, value: odd.away_value, team: teams.teamB },
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

function EventChip({ event, teams = [] }) {
  const minute = event.elapsed !== null && event.elapsed !== undefined
    ? `${event.elapsed}${event.extra_time ? `+${event.extra_time}` : ''}'`
    : '';
  const assist = event.assist_name ? `, assist ${event.assist_name}` : '';
  const team = event.team_name ? teamIdentity(event.team_name, teams) : null;
  return (
    <span className="event-chip" title={event.team_name || undefined}>
      {team && <TeamFlag team={team} />}
      <strong>{minute}</strong>
      {event.player_name || formatEventType(event.event_type)}
      {assist}
      {event.event_detail ? ` (${formatEventDetail(event.event_detail)})` : ''}
    </span>
  );
}

function LeaderboardPage({ players, matches, predictions, refresh }) {
  const rows = calculateLeaderboard(players, matches, predictions);
  const visibleRows = rows.filter((row) => row.predictions_submitted_count > 0);
  const liveRows = calculateLiveLeaderboard(players, matches, predictions);
  return (
    <section>
      <PageTitle title="Leaderboard" action={<button onClick={refresh}>Refresh</button>} />
      <p className="muted">You will see your name here once you submit a prediction.</p>
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
            {visibleRows.map((row, index) => (
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
      {!visibleRows.length && <EmptyState text="Leaderboard will appear after the first prediction is submitted." />}
    </section>
  );
}

function GroupsPage({ matches, teams, teamFavorites, toggleTeamFavorite, player, refresh, navigate, routeBase }) {
  const groups = calculateGroupStandings(matches);
  return (
    <section>
      <PageTitle title="Groups" action={<button onClick={refresh}>Refresh</button>} />
      <div className="group-table-list">
        {groups.map((group) => (
          <article className="panel group-table" key={group.groupName}>
            <h2>{group.groupName}</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Nation</th>
                    <th>P</th>
                    <th>W</th>
                    <th>D</th>
                    <th>L</th>
                    <th>GF</th>
                    <th>GA</th>
                    <th>GD</th>
                    <th>Pts</th>
                  </tr>
                </thead>
                <tbody>
                  {group.rows.map((row) => {
                    const team = teamIdentity(row.team, teams);
                    return (
                      <tr key={row.team}>
                        <td>{row.position}</td>
                        <td>
                          <div className="favorite-team-cell">
                            <FavoriteTeamButton
                              team={team}
                              isFavorite={isFavoriteTeam(team, teamFavorites, player)}
                              onToggle={toggleTeamFavorite}
                              player={player}
                            />
                            <button className="table-team" onClick={() => navigate(buildRoute(routeBase, `/nations/${team.slug}`))}>
                              <TeamFlag team={team} />
                              <span>{row.team}</span>
                            </button>
                          </div>
                        </td>
                        <td>{row.played}</td>
                        <td>{row.won}</td>
                        <td>{row.drawn}</td>
                        <td>{row.lost}</td>
                        <td>{row.goals_for}</td>
                        <td>{row.goals_against}</td>
                        <td>{row.goal_difference}</td>
                        <td><strong>{row.points}</strong></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </article>
        ))}
      </div>
      {!groups.length && <EmptyState text="Group tables will appear after group-stage results are entered." />}
    </section>
  );
}

function FavoritesPage({ player, teams, teamFavorites, toggleTeamFavorite, navigate, routeBase }) {
  if (!player) {
    return <NeedPlayer navigate={navigate} routeBase={routeBase} />;
  }
  const favorites = teamFavorites
    .filter((favorite) => favorite.player_id === player.id)
    .map((favorite) => ({
      favorite,
      team: teamIdentity(favorite.team_name || favorite.team_slug, teams),
    }))
    .sort((a, b) => a.team.name.localeCompare(b.team.name));

  return (
    <section>
      <PageTitle title="Favorites" />
      <p className="muted">Star teams from Groups or a nation page to keep them here.</p>
      <div className="favorite-grid">
        {favorites.map(({ favorite, team }) => (
          <article className="favorite-card" key={favorite.id || team.slug}>
            <button className="favorite-card-main" onClick={() => navigate(buildRoute(routeBase, `/nations/${team.slug}`))}>
              <TeamFlag team={team} />
              <span>
                <strong>{team.name}</strong>
                {team.country && <small>{team.country}</small>}
              </span>
            </button>
            <FavoriteTeamButton
              team={team}
              isFavorite
              onToggle={toggleTeamFavorite}
              player={player}
            />
          </article>
        ))}
      </div>
      {!favorites.length && <EmptyState text="No favorite teams yet. Tap a star beside a team to add one." />}
    </section>
  );
}

function NationPage({ route, matches, teams, teamFavorites, toggleTeamFavorite, player, matchStatistics, refresh, navigate, routeBase }) {
  const slug = route.replace('/nations/', '').split('/')[0];
  const providerTeam = teams.find((team) => team.slug === slug);
  const fallbackName = slug.split('-').map((part) => formatSentenceFragment(part)).join(' ');
  const team = teamIdentity(providerTeam?.name || fallbackName, teams);
  const teamKey = normalizeName(team.name);
  const teamMatches = matches
    .filter((match) => match.is_published && (
      normalizeName(match.team_a) === teamKey ||
      normalizeName(match.team_b) === teamKey ||
      teamIdentity(match.team_a, teams).slug === slug ||
      teamIdentity(match.team_b, teams).slug === slug
    ))
    .sort((a, b) => new Date(a.kickoff_time).getTime() - new Date(b.kickoff_time).getTime());
  const groupName = teamMatches.find((match) => match.group_name)?.group_name || '';
  const standing = getTeamStanding(matches, team.name);
  const recentStatistics = matchStatistics.filter((row) => normalizeName(row.team_name) === teamKey).slice(-3);

  return (
    <section>
      <PageTitle title={team.name} action={<button onClick={refresh}>Refresh</button>} />
      <div className="nation-hero panel">
        <div className="nation-flag-stack">
          <FavoriteTeamButton
            team={team}
            isFavorite={isFavoriteTeam(team, teamFavorites, player)}
            onToggle={toggleTeamFavorite}
            player={player}
          />
          <TeamFlag team={team} />
        </div>
        <div>
          <p className="eyebrow">{groupName || team.country || 'Nation profile'}</p>
          <h1>{team.name}</h1>
          <p className="muted">{teamMatches.length} published fixture{teamMatches.length === 1 ? '' : 's'} in this game.</p>
        </div>
        {team.logo_url && <img className="nation-logo" src={team.logo_url} alt={`${team.name} logo`} loading="lazy" />}
      </div>

      <div className="nation-grid">
        <div className="panel">
          <h2>Group standing</h2>
          {standing ? (
            <div className="standing-card">
              <strong>{standing.position}</strong>
              <span>{standing.points} pts</span>
              <span>{standing.played} played</span>
              <span>GD {standing.goal_difference}</span>
            </div>
          ) : (
            <p className="muted">No completed group matches yet.</p>
          )}
        </div>
      </div>

      <div className="panel">
        <h2>Fixtures and results</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Match</th>
                <th>Status</th>
                <th>Score</th>
              </tr>
            </thead>
            <tbody>
              {teamMatches.map((match) => (
                <tr key={match.id}>
                  <td>{formatDate(match.kickoff_time)}</td>
                  <td>
                    <button className="table-team match-link" onClick={() => navigate(`${buildRoute(routeBase, '/matches')}#match-${match.id}`)}>
                      <span>{match.team_a} vs {match.team_b}</span>
                    </button>
                  </td>
                  <td>{getLiveStatusLabel(match)}</td>
                  <td>{isFinalScoreComplete(match) ? `${match.team_a_score} - ${match.team_b_score}` : getLiveScore(match) || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!teamMatches.length && <p className="muted">No published fixtures found for this nation.</p>}
      </div>

      <div className="panel">
        <h2>Recent match statistics</h2>
        {recentStatistics.length > 0 ? (
          <div className="aid-grid">
            {recentStatistics.map((row) => (
              <article key={row.id}>
                <strong>{row.team_name}</strong>
                <small>Synced {row.last_synced_at ? formatDate(row.last_synced_at) : 'recently'}</small>
                {Object.entries(row.statistics || {}).slice(0, 4).map(([label, value]) => (
                  <span key={label}>{formatStatLabel(label)}: {formatStatValue(value)}</span>
                ))}
              </article>
            ))}
          </div>
        ) : (
          <p className="muted">Live/statistical data will appear here after provider sync captures it.</p>
        )}
      </div>

      <button onClick={() => navigate(buildRoute(routeBase, '/matches'))}>Back to matches</button>
    </section>
  );
}

function PredictionsPage({ players, matches, predictions, teams, refresh, navigate, routeBase }) {
  const [matchView, setMatchView] = useState('upcoming');
  const [expandedMatchIds, setExpandedMatchIds] = useState(() => new Set());
  const [refreshState, setRefreshState] = useState('idle');
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
  const liveMatches = useMemo(
    () =>
      publishedMatches
        .filter((match) => isMatchLive(match))
        .sort((a, b) => new Date(a.kickoff_time).getTime() - new Date(b.kickoff_time).getTime()),
    [publishedMatches],
  );
  const upcomingMatches = useMemo(
    () =>
      publishedMatches
        .filter((match) => isMatchUpcoming(match))
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
  const toggleExpanded = (matchId) => {
    setExpandedMatchIds((current) => {
      const next = new Set(current);
      if (next.has(matchId)) next.delete(matchId);
      else next.add(matchId);
      return next;
    });
  };
  const handleRefresh = async () => {
    if (refreshState === 'refreshing') return;
    setRefreshState('refreshing');
    try {
      await refresh();
      setRefreshState('done');
    } catch (err) {
      setRefreshState('idle');
    }
  };

  return (
    <section>
      <PageTitle
        title="Picks"
        action={
          <button onClick={handleRefresh} disabled={refreshState === 'refreshing'}>
            {refreshState === 'refreshing' ? 'Refreshing...' : 'Refresh'}
          </button>
        }
      />
      {liveMatches.length > 0 && (
        <section className="live-section" aria-labelledby="live-picks-title">
          <div className="section-heading">
            <h2 id="live-picks-title">Live now</h2>
            <span>{liveMatches.length} active match{liveMatches.length === 1 ? '' : 'es'}</span>
          </div>
          <div className="match-list">
            {liveMatches.map((match) => (
              <PicksMatchSummary
                key={match.id}
                match={match}
                matchPredictions={predictionsByMatch.get(match.id) || []}
                playersById={playersById}
                activePlayerCount={activePlayerCount}
                teams={teams}
                navigate={navigate}
                routeBase={routeBase}
                expanded
                live
              />
            ))}
          </div>
        </section>
      )}
      {publishedMatches.length > 0 && (
        <>
          <div className="tab-row" role="tablist" aria-label="Picks match view">
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
          <div className="picks-dashboard">
            <div className="dashboard-grid">
              {visibleMatches.map((match) => (
                <PicksMatchSummary
                  key={match.id}
                  match={match}
                  matchPredictions={predictionsByMatch.get(match.id) || []}
                  playersById={playersById}
                  activePlayerCount={activePlayerCount}
                  teams={teams}
                  navigate={navigate}
                  routeBase={routeBase}
                  expanded={expandedMatchIds.has(match.id)}
                  onToggle={() => toggleExpanded(match.id)}
                />
              ))}
            </div>
          </div>
          {visibleMatches.length === 0 && (
            <EmptyState text={matchView === 'played' ? 'No played matches yet.' : 'No upcoming matches left.'} />
          )}
        </>
      )}
      {!publishedMatches.length && <EmptyState text="No published matches yet." />}
    </section>
  );
}

function PicksMatchSummary({
  match,
  matchPredictions,
  playersById,
  activePlayerCount,
  teams,
  navigate,
  routeBase,
  expanded,
  onToggle,
  live = false,
}) {
  const canReveal = isMatchLocked(match);
  const activeSubmittedCount = matchPredictions.filter((prediction) =>
    isPlayerActive(playersById.get(prediction.player_id)),
  ).length;
  const percent = activePlayerCount ? Math.round((activeSubmittedCount / activePlayerCount) * 100) : 0;

  return (
    <article className={`dashboard-item picks-summary${live ? ' live-card' : ''}${expanded ? ' expanded' : ''}`}>
      <div className="picks-summary-main">
        <div>
          <div className="dashboard-match-teams">
            <DashboardTeamLink team={teamIdentity(match.team_a, teams)} navigate={navigate} routeBase={routeBase} />
            <small>vs</small>
            <DashboardTeamLink team={teamIdentity(match.team_b, teams)} navigate={navigate} routeBase={routeBase} />
          </div>
          <span>{match.group_name || match.stage || 'Match'} - {formatDate(match.kickoff_time)}</span>
        </div>
        {!live && (
          <button className="ghost picks-expand-button" onClick={onToggle} aria-expanded={expanded}>
            {expanded ? 'Hide picks' : 'Show picks'}
          </button>
        )}
      </div>
      <div className="prediction-count">
        <strong>{activeSubmittedCount}</strong>
        <span>/ {activePlayerCount} players</span>
      </div>
      <div className="progress-track" aria-label={`${percent}% submitted`}>
        <span style={{ width: `${percent}%` }} />
      </div>
      {expanded && (
        <PicksTable
          match={match}
          matchPredictions={matchPredictions}
          playersById={playersById}
          activeSubmittedCount={activeSubmittedCount}
          activePlayerCount={activePlayerCount}
          canReveal={canReveal}
          live={live}
        />
      )}
    </article>
  );
}

function PicksTable({ match, matchPredictions, playersById, activeSubmittedCount, activePlayerCount, canReveal, live }) {
  const liveScoreA = match?.live_team_a_score;
  const liveScoreB = match?.live_team_b_score;
  const hasLiveScore = live && Number.isInteger(liveScoreA) && Number.isInteger(liveScoreB);
  const hasFinalScore = !live && isMatchPlayed(match) && isFinalScoreComplete(match);
  const hasRankedScore = hasLiveScore || hasFinalScore;
  const scoreA = hasLiveScore ? liveScoreA : match?.team_a_score;
  const scoreB = hasLiveScore ? liveScoreB : match?.team_b_score;
  const scoreLabel = hasLiveScore ? 'Live score' : 'Final score';
  const pointsLabel = hasLiveScore ? 'Live pts' : 'Points';
  const exactBadgeLabel = hasLiveScore ? 'Exact live score' : 'Exact score';
  const rows = hasRankedScore
    ? [...matchPredictions].sort((a, b) => {
        const pointsA = hasLiveScore ? livePredictionPoints(a, match) ?? -1 : predictionPoints(a, match);
        const pointsB = hasLiveScore ? livePredictionPoints(b, match) ?? -1 : predictionPoints(b, match);
        if (pointsA !== pointsB) return pointsB - pointsA;
        return getPlayerDisplayName(playersById.get(a.player_id)).localeCompare(
          getPlayerDisplayName(playersById.get(b.player_id)),
        );
      })
    : matchPredictions;

  return (
    <div className="picks-expanded">
      <p className="muted">{activeSubmittedCount} of {activePlayerCount} active players submitted.</p>
      {hasRankedScore && (
        <p className="live-score-pill">{scoreLabel}: {scoreA} - {scoreB}</p>
      )}
      {!canReveal && (
        <p className="muted">
          Score picks stay hidden until kickoff or when the admin locks this match.
        </p>
      )}
      {matchPredictions.length > 0 && (
        <div className="table-wrap compact-table">
          <table className={`picks-table${hasRankedScore ? ' live-picks-table' : ''}`}>
            <thead>
              <tr>
                {hasRankedScore && <th>Rank</th>}
                <th>Player</th>
                <th>Pick</th>
                {hasRankedScore && <th>{pointsLabel}</th>}
                <th>Submitted</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((prediction, index) => {
                const points = hasRankedScore
                  ? hasLiveScore
                    ? livePredictionPoints(prediction, match)
                    : predictionPoints(prediction, match)
                  : null;
                const exactScore = hasRankedScore && points === 3;
                return (
                  <tr key={prediction.id} className={exactScore ? 'exact-live-pick' : ''}>
                    {hasRankedScore && <td>{index + 1}</td>}
                    <td>{getPlayerDisplayName(playersById.get(prediction.player_id))}</td>
                    <td>
                      <span className="pick-score-cell">
                        <span>
                          {canReveal
                            ? `${prediction.predicted_team_a_score} - ${prediction.predicted_team_b_score}`
                            : 'Hidden until kickoff'}
                        </span>
                        {exactScore && <span className="exact-live-badge">{exactBadgeLabel}</span>}
                      </span>
                    </td>
                    {hasRankedScore && <td>{points ?? 'n/a'}</td>}
                    <td>{formatDate(prediction.submitted_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {matchPredictions.length === 0 && (
        <p className="muted">No picks submitted for this match yet.</p>
      )}
    </div>
  );
}

function DashboardTeamLink({ team, navigate, routeBase = '' }) {
  const openNation = () => {
    if (team?.slug && navigate) navigate(buildRoute(routeBase, `/nations/${team.slug}`));
  };
  return (
    <button className="dashboard-team-link" onClick={openNation} disabled={!team?.slug} title={`Open ${team.name} profile`}>
      <TeamFlag team={team} />
      <span>{team.name}</span>
    </button>
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
              sessionStorage.setItem('admin-password', password);
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

function AdminTools({
  matches,
  refresh,
  setMessage,
  setError,
  tournament,
  tournaments,
  sourceTournaments,
  allPlayers,
  allMatches,
  allPredictions,
  allTeamFavorites,
  navigate,
}) {
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
  const [syncing, setSyncing] = useState('');

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
      const { error } = await supabase.from('matches').upsert(fixtures, { onConflict: 'tournament_id,external_match_id' });
      throwIfError(error);
      setMessage(`Imported ${fixtures.length} fixture${fixtures.length === 1 ? '' : 's'}.`);
      await refresh();
    } catch (err) {
      setError(err.message || 'Could not import fixtures.');
    }
  };

  const runManualSync = async (sync) => {
    setMessage('');
    setError('');
    setSyncing(sync);
    try {
      const response = await fetch('/api/admin-sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-password': sessionStorage.getItem('admin-password') || ADMIN_PASSWORD,
        },
        body: JSON.stringify({ sync }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Manual sync failed.');

      const parts = [];
      if (payload.prematch) {
        parts.push(`insights ${payload.prematch.aids || 0}, odds ${payload.prematch.odds || 0}, links ${payload.prematch.linkedFixtures || 0}`);
      }
      if (payload.live) {
        parts.push(`matches ${payload.live.synced || 0}, events ${payload.live.events || 0}, stats ${payload.live.statistics || 0}`);
      }
      if (payload.clones?.refreshed) {
        parts.push(`clones refreshed ${payload.clones.refreshed}`);
      }
      const warningCount = (payload.prematch?.warnings?.length || 0) + (payload.live?.warnings?.length || 0);
      setMessage(`Manual sync complete: ${parts.join('; ') || payload.sync}${warningCount ? `; ${warningCount} provider warning${warningCount === 1 ? '' : 's'}` : ''}.`);
      await refresh();
    } catch (err) {
      setError(formatManualSyncError(err.message || 'Manual sync failed.'));
    } finally {
      setSyncing('');
    }
  };

  return (
    <section>
      <PageTitle title="Admin" action={<button onClick={refresh}>Refresh</button>} />
      <CloneGroupsPanel
        tournaments={tournaments}
        sourceTournaments={sourceTournaments}
        players={allPlayers}
        matches={allMatches}
        predictions={allPredictions}
        favorites={allTeamFavorites}
        refresh={refresh}
        setMessage={setMessage}
        setError={setError}
        navigate={navigate}
      />
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
          <div className="button-row">
            <button onClick={() => runManualSync('prematch')} disabled={Boolean(syncing)}>
              {syncing === 'prematch' ? 'Syncing insights...' : 'Sync insights'}
            </button>
            <button onClick={() => runManualSync('live')} disabled={Boolean(syncing)}>
              {syncing === 'live' ? 'Syncing live...' : 'Sync live/recaps'}
            </button>
            <button className="primary" onClick={() => runManualSync('all')} disabled={Boolean(syncing)}>
              {syncing === 'all' ? 'Syncing...' : 'Sync both'}
            </button>
          </div>
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

function CloneGroupsPanel({
  tournaments,
  sourceTournaments,
  players,
  matches,
  predictions,
  favorites,
  refresh,
  setMessage,
  setError,
  navigate,
}) {
  const defaultSourceId = sourceTournaments[0]?.id || '';
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [sourceTournamentId, setSourceTournamentId] = useState(defaultSourceId);
  const [busy, setBusy] = useState('');
  const clones = tournaments.filter((item) => item.is_clone);
  const sourceById = new Map(tournaments.map((item) => [item.id, item]));

  useEffect(() => {
    if (!sourceTournamentId && defaultSourceId) setSourceTournamentId(defaultSourceId);
  }, [defaultSourceId, sourceTournamentId]);

  const runCloneAction = async (body) => {
    const response = await fetch('/api/clone-groups', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-password': sessionStorage.getItem('admin-password') || ADMIN_PASSWORD,
      },
      body: JSON.stringify(body),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Clone operation failed.');
    return payload;
  };

  const createClone = async () => {
    setMessage('');
    setError('');
    setBusy('create');
    try {
      const payload = await runCloneAction({
        action: 'create',
        name,
        slug,
        source_tournament_id: sourceTournamentId,
      });
      setMessage(`Created ${payload.clone.name}. Copied ${payload.copy.matches || 0} matches.`);
      setName('');
      setSlug('');
      await refresh();
    } catch (err) {
      setError(err.message || 'Could not create clone group.');
    } finally {
      setBusy('');
    }
  };

  const refreshClone = async (clone) => {
    setMessage('');
    setError('');
    setBusy(clone.id);
    try {
      const payload = await runCloneAction({ action: 'refresh', clone_tournament_id: clone.id });
      setMessage(`Refreshed ${clone.name} from ${payload.source.name}. Copied ${payload.copy.matches || 0} matches.`);
      await refresh();
    } catch (err) {
      setError(err.message || 'Could not refresh clone group.');
    } finally {
      setBusy('');
    }
  };

  const copyShareLink = async (clone) => {
    const link = `${window.location.origin}/g/${clone.slug}`;
    try {
      await navigator.clipboard.writeText(link);
      setMessage(`Copied share link for ${clone.name}.`);
    } catch {
      setMessage(`Share link: ${link}`);
    }
  };

  return (
    <section className="panel clone-panel">
      <div className="section-heading">
        <div>
          <h2>Group clones</h2>
          <p className="muted">Create private groups that copy football data from an original app without extra provider calls.</p>
        </div>
      </div>
      <div className="clone-create-grid">
        <AdminInput label="Group name" value={name} onChange={(value) => {
          setName(value);
          if (!slug) setSlug(slugifyTeamName(value));
        }} />
        <AdminInput label="Group slug" value={slug} onChange={(value) => setSlug(slugifyTeamName(value))} />
        <label>
          Source app
          <select value={sourceTournamentId} onChange={(event) => setSourceTournamentId(event.target.value)}>
            {sourceTournaments.map((source) => (
              <option key={source.id} value={source.id}>{source.name}</option>
            ))}
          </select>
        </label>
        <button className="primary" onClick={createClone} disabled={busy === 'create' || !sourceTournamentId}>
          {busy === 'create' ? 'Creating...' : 'Create clone'}
        </button>
      </div>
      <div className="clone-grid">
        {clones.map((clone) => {
          const kpis = getCloneKpis(clone, { players, matches, predictions, favorites });
          const source = sourceById.get(clone.source_tournament_id);
          return (
            <article className="clone-card" key={clone.id}>
              <div>
                <strong>{clone.name}</strong>
                <p className="muted">Source: {source?.name || 'Unknown source'}</p>
                <p className="muted">Last internal refresh: {clone.last_internal_refresh_at ? formatDate(clone.last_internal_refresh_at) : 'Not refreshed yet'}</p>
              </div>
              <div className="clone-kpis">
                <span><strong>{kpis.players}</strong> players</span>
                <span><strong>{kpis.activePlayers}</strong> active</span>
                <span><strong>{kpis.predictions}</strong> picks</span>
                <span><strong>{kpis.publishedMatches}</strong> published</span>
                <span><strong>{kpis.completedMatches}</strong> completed</span>
                <span><strong>{kpis.favorites}</strong> favorites</span>
              </div>
              <p className="muted">Last activity: {kpis.lastActivity ? formatDate(kpis.lastActivity) : 'No player activity yet'}</p>
              <div className="button-row">
                <button onClick={() => navigate(`/g/${clone.slug}`)}>Open</button>
                <button onClick={() => copyShareLink(clone)}>Copy link</button>
                <button onClick={() => refreshClone(clone)} disabled={busy === clone.id}>
                  {busy === clone.id ? 'Refreshing...' : 'Refresh from source'}
                </button>
              </div>
            </article>
          );
        })}
      </div>
      {!clones.length && <p className="muted">No clones yet. Create one from an original source app above.</p>}
    </section>
  );
}

function getCloneKpis(clone, { players, matches, predictions, favorites }) {
  const clonePlayers = players.filter((player) => player.tournament_id === clone.id);
  const cloneMatches = matches.filter((match) => match.tournament_id === clone.id);
  const clonePredictions = predictions.filter((prediction) => prediction.tournament_id === clone.id);
  const cloneFavorites = favorites.filter((favorite) => favorite.tournament_id === clone.id);
  return {
    players: clonePlayers.length,
    activePlayers: clonePlayers.filter(isPlayerActive).length,
    predictions: clonePredictions.length,
    favorites: cloneFavorites.length,
    publishedMatches: cloneMatches.filter((match) => match.is_published).length,
    completedMatches: cloneMatches.filter(isFinalScoreComplete).length,
    lastActivity: latestTimestamp([
      ...clonePlayers.map((player) => player.created_at),
      ...clonePredictions.map((prediction) => prediction.updated_at || prediction.submitted_at),
      ...cloneFavorites.map((favorite) => favorite.created_at),
    ]),
  };
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

function NeedPlayer({ navigate, routeBase = '' }) {
  return (
    <div className="panel centered">
      <h1>Enter your name first</h1>
      <p className="muted">Your profile lets the app save predictions to the shared leaderboard.</p>
      <button className="primary" onClick={() => navigate(buildRoute(routeBase, '/'))}>Go to welcome page</button>
    </div>
  );
}

function InactivePlayer({ navigate, routeBase = '' }) {
  return (
    <div className="panel centered">
      <h1>Profile inactive</h1>
      <p className="muted">This duplicate profile was deactivated. Use the active profile for this display name.</p>
      <button className="primary" onClick={() => navigate(buildRoute(routeBase, '/'))}>Go to welcome page</button>
    </div>
  );
}

function EmptyState({ text }) {
  return <p className="empty">{text}</p>;
}

function useRoute() {
  const normalize = () => {
    return normalizeRoute(window.location.pathname);
  };
  const [route, setRoute] = useState(normalize);
  useEffect(() => {
    const onPopState = () => setRoute(normalize());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
  return [route, setRoute];
}

function normalizeRoute(value) {
  const path = String(value || '/').split(/[?#]/)[0] || '/';
  const groupMatch = path.match(/^\/g\/([^/]+)(\/.*)?$/);
  if (groupMatch) {
    const groupPath = groupMatch[2] || '/';
    const normalizedGroupPath = normalizePageRoute(groupPath);
    return `/g/${groupMatch[1]}${normalizedGroupPath === '/' ? '' : normalizedGroupPath}`;
  }
  return normalizePageRoute(path);
}

function normalizePageRoute(path) {
  if (path.startsWith('/nations/')) return path;
  return ['/', '/matches', '/predictions', '/groups', '/favorites', '/leaderboard', '/admin'].includes(path) ? path : '/';
}

function getRouteGroupSlug(route) {
  return String(route || '').match(/^\/g\/([^/]+)/)?.[1] || '';
}

function getPageRoute(route) {
  const groupMatch = String(route || '/').match(/^\/g\/[^/]+(\/.*)?$/);
  return groupMatch ? groupMatch[1] || '/' : route;
}

function buildRoute(routeBase, pageRoute = '/') {
  if (!routeBase) return pageRoute;
  return `${routeBase}${pageRoute === '/' ? '' : pageRoute}`;
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

function formatRelativeTime(value, now = Date.now()) {
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return '';
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function latestTimestamp(values = []) {
  return values
    .filter(Boolean)
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())
    .at(-1) || '';
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

function formatManualSyncError(message) {
  const value = String(message || '');
  if (/API-Football .* failed with 429/i.test(value)) {
    return 'The football data provider is temporarily rate-limited. Please wait a few minutes and try the sync again.';
  }
  if (/API-Football .* failed with 5\d\d/i.test(value)) {
    return 'The football data provider is temporarily unavailable. Please try the sync again shortly.';
  }
  return value || 'Manual sync failed.';
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

function formatStatLabel(label) {
  const labels = {
    'Ball Possession': 'Possession',
    'Shots on Goal': 'Shots on target',
    'Passes %': 'Pass accuracy',
  };
  return labels[label] || formatSentenceFragment(label);
}

function formatStatValue(value) {
  if (value === null || value === undefined || value === '') return '-';
  return String(value);
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
