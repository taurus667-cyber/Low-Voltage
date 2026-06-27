import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { supabase, isSupabaseConfigured } from './lib/supabase.js';
import { calculateLeaderboard, getLeaderboardRankStatus, getPlayerTop10Status, isFinalScoreComplete, predictionPoints } from './lib/scoring.js';
import { calculateLiveLeaderboard, livePredictionPoints } from './lib/livePoints.js';
import { getActiveTournament, getTournamentBySlug, scopedRows } from './lib/tournament.js';
import {
  getLiveStatusLabel,
  getMatchLockReason,
  isKickoffClosed,
  isMatchLive,
  isMatchLocked,
  isMatchPlayed,
  isPlayerFacingMatch,
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
import { groupKeyEvents, splitMatchEvents } from './lib/matchEvents.js';
import { normalizePlayerName, validatePlayerFullName } from './lib/playerNames.js';
import {
  getProfileEntryState,
  getProfilePickHint,
  getRenameSummary,
  PROFILE_ENTRY_MODES,
} from './lib/profileEntryFlow.js';
import { buildPlayerStats } from './lib/playerStats.js';
import { PREDICTION_STYLES, buildPredictionStyle, buildPredictionStylesByPlayer } from './lib/predictionStyle.js';
import { isPlayerActive, isPublicStatsPlayer } from './lib/playerVisibility.js';
import { selectAllRows } from './lib/supabasePaging.js';
import { buildBracket, getBracketHealth, getMatchWinner, getTeamSeedLabel } from './lib/bracket.js';
import { Analytics } from '@vercel/analytics/react';
import './styles.css';

const ADMIN_PASSWORD = import.meta.env.VITE_ADMIN_PASSWORD || '';
const STATUSES = ['scheduled', 'live', 'finished'];
const KSA_TIME_ZONE = 'Asia/Riyadh';

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
  const [top10Celebration, setTop10Celebration] = useState(null);
  const [top10Protection, setTop10ProtectionState] = useState(() => readStoredTop10Protection());
  const setTop10Protection = useCallback((value) => {
    setTop10ProtectionState(value);
    writeStoredTop10Protection(value);
  }, []);

  const refresh = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    setLoading(true);
    setError('');
    try {
      const [tournamentRows, playerRows, matchRows, predictionRows, teamRows, favoriteRows] = await Promise.all([
        optionalSelect(supabase.from('tournaments').select('*').order('created_at')),
        supabase.from('players').select('id,tournament_id,name,is_active,hidden_from_public_stats,deactivated_at,deactivation_reason,created_at').order('created_at'),
        supabase.from('matches').select('*').order('kickoff_time'),
        selectAllRows(() => supabase.from('predictions').select('*').order('submitted_at')),
        optionalSelect(supabase.from('teams').select('*').order('name')),
        optionalSelect(supabase.from('player_favorite_teams').select('*').order('created_at')),
      ]);
      throwIfError(playerRows.error);
      throwIfError(matchRows.error);
      throwIfError(predictionRows.error);
      const loadedTournaments = tournamentRows.data || [];
      const loadedMatches = matchRows.data || [];
      const selectedTournament = getTournamentBySlug(loadedTournaments, getRouteGroupSlug(route)) || getActiveTournament(loadedTournaments);
      const selectedMatches = scopedRows(loadedMatches, selectedTournament);
      const selectedMatchIds = selectedMatches.map((match) => match.id);
      const currentPageRoute = getPageRoute(route);
      const needsMatchDetails = currentPageRoute === '/matches' || currentPageRoute.startsWith('/nations/');
      const needsPredictionStyleData = currentPageRoute === '/stats' || currentPageRoute === '/leaderboard';
      const hasLiveMatches = selectedMatches.some((match) => isMatchLive(match));
      const [eventRows, statisticRows, lineupRows] = hasLiveMatches || needsMatchDetails
        ? await Promise.all([
            selectRowsForMatches(supabase, 'match_events', selectedMatchIds, 'elapsed'),
            selectRowsForMatches(supabase, 'match_statistics', selectedMatchIds),
            selectRowsForMatches(supabase, 'match_lineups', selectedMatchIds),
          ])
        : [{ data: [] }, { data: [] }, { data: [] }];
      const [aidRows, oddsRows] = hasLiveMatches || needsMatchDetails || needsPredictionStyleData
        ? await Promise.all([
            selectRowsForMatches(supabase, 'match_prediction_aids', selectedMatchIds, 'aid_type'),
            selectRowsForMatches(supabase, 'match_odds', selectedMatchIds),
          ])
        : [{ data: [] }, { data: [] }];
      setTournaments(loadedTournaments);
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
  const leaderboardRows = useMemo(
    () => calculateLeaderboard(scopedPlayers.filter(isPublicStatsPlayer), scopedMatches, scopedPredictions),
    [scopedPlayers, scopedMatches, scopedPredictions],
  );
  const currentTop10Status = useMemo(
    () => getPlayerTop10Status(leaderboardRows, currentScopedPlayer?.id),
    [leaderboardRows, currentScopedPlayer?.id],
  );
  const loadTop10Protection = useCallback(async () => {
    if (!activeTournament?.id || !player?.id || !player?.player_token) return null;
    const payload = await runTop10Request({
      action: 'reveal',
      tournament_id: activeTournament.id,
      player_id: player.id,
      player_token: player.player_token,
    });
    if (payload.protected && payload.code) {
      const protection = { protected: true, playerId: player.id, code: payload.code, statusLabel: payload.status_label || 'Top 10' };
      setTop10Protection(protection);
      return { ...payload, ...protection };
    }
    const protection = { protected: false, playerId: player.id };
    setTop10Protection(protection);
    return { ...payload, ...protection };
  }, [activeTournament?.id, player?.id, player?.player_token]);
  useEffect(() => {
    if (!player?.id) {
      setTop10Protection(null);
      return;
    }
    if (top10Protection?.playerId && top10Protection.playerId !== player.id) {
      setTop10Protection(null);
    }
  }, [player?.id, top10Protection?.playerId, setTop10Protection]);
  const openTop10Celebration = useCallback(async () => {
    try {
      const protection = top10Protection?.code && top10Protection.playerId === player?.id ? top10Protection : await loadTop10Protection();
      if (!protection?.code) {
        navigate(buildRoute(routeBase, '/stats'));
        return;
      }
      setTop10Celebration(createTop10Celebration({
        player: currentScopedPlayer || player,
        code: protection.code,
        status: currentTop10Status,
        firstReveal: false,
      }));
    } catch (err) {
      setError(err.message || 'Could not load your Top 10 code.');
    }
  }, [top10Protection, loadTop10Protection, currentScopedPlayer, player, currentTop10Status, routeBase]);

  useEffect(() => {
    if (!activeTournament?.id || !player?.id || !player?.player_token) {
      setTop10Protection(null);
      return;
    }
    let cancelled = false;
    const syncAndRevealTop10Code = async () => {
      setTop10Protection(null);
      try {
        await runTop10Request({ action: 'sync', tournament_id: activeTournament.id });
        const payload = await loadTop10Protection();
        if (!cancelled && payload.protected && payload.firstReveal && payload.code) {
          setTop10Protection({ protected: true, playerId: player.id, code: payload.code, statusLabel: payload.status_label || 'Top 10' });
          setTop10Celebration(createTop10Celebration({
            player: currentScopedPlayer || player,
            code: payload.code,
            status: currentTop10Status,
            firstReveal: true,
          }));
        } else if (!cancelled && payload.protected && payload.code) {
          setTop10Protection({ protected: true, playerId: player.id, code: payload.code, statusLabel: payload.status_label || 'Top 10' });
        } else if (!cancelled) {
          setTop10Protection({ protected: false, playerId: player.id });
        }
      } catch {
        // The offline preview has no API server; production uses this for Top 10 protection.
      }
    };
    syncAndRevealTop10Code();
    return () => {
      cancelled = true;
    };
  }, [activeTournament?.id, player?.id, player?.player_token, currentScopedPlayer?.id, currentScopedPlayer?.name, currentTop10Status?.rank, loadTop10Protection]);

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
    setPlayers,
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
    currentTop10Status,
    top10Protection,
    setTop10Protection,
    setTop10Celebration,
    openTop10Celebration,
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
        <button className={`help-link ${pageRoute === '/help' ? 'active' : ''}`} onClick={() => navigate(buildRoute(routeBase, '/help'))}>
          Help
        </button>
        {currentTop10Status && (
          <button
            className={`top10-badge ${currentTop10Status.status_key === 'leader' ? 'leader' : ''}`}
            onClick={openTop10Celebration}
          >
            {currentTop10Status.status_label} #{currentTop10Status.rank}
          </button>
        )}
        <nav aria-label="Primary navigation">
          <button className={pageRoute === '/matches' ? 'active' : ''} onClick={() => navigate(buildRoute(routeBase, '/matches'))}>
            Matches
          </button>
          <button className={pageRoute === '/predictions' ? 'active' : ''} onClick={() => navigate(buildRoute(routeBase, '/predictions'))}>
            Picks
          </button>
          <button className={pageRoute === '/stats' ? 'active' : ''} onClick={() => navigate(buildRoute(routeBase, '/stats'))}>
            My Stats
          </button>
          <button className={pageRoute === '/groups' ? 'active' : ''} onClick={() => navigate(buildRoute(routeBase, '/groups'))}>
            Groups
          </button>
          <button className={pageRoute === '/bracket' ? 'active' : ''} onClick={() => navigate(buildRoute(routeBase, '/bracket'))}>
            Bracket
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
        {pageRoute === '/stats' && <StatsPage {...pageProps} storedPlayer={player} />}
        {pageRoute === '/groups' && <GroupsPage {...pageProps} />}
        {pageRoute === '/bracket' && <BracketPage {...pageProps} />}
        {pageRoute === '/favorites' && <FavoritesPage {...pageProps} />}
        {pageRoute.startsWith('/nations/') && <NationPage {...pageProps} route={pageRoute} />}
        {pageRoute === '/leaderboard' && <LeaderboardPage {...pageProps} />}
        {pageRoute === '/top10-code' && <Top10CodePage {...pageProps} storedPlayer={player} />}
        {pageRoute === '/admin' && <AdminPage {...pageProps} />}
        {pageRoute === '/help' && <HelpPage {...pageProps} />}
      </main>
      {top10Celebration && (
        <Top10CelebrationModal
          celebration={top10Celebration}
          onClose={() => setTop10Celebration(null)}
        />
      )}
      <Analytics />
    </div>
  );
}

function HomePage({
  player,
  setPlayer,
  setPlayers,
  players,
  refresh,
  predictions,
  setMessage,
  setError,
  navigate,
  tournament,
  routeBase,
  currentTop10Status,
  setTop10Protection,
  setTop10Celebration,
}) {
  const [name, setName] = useState(player?.name || '');
  const [matches, setMatches] = useState([]);
  const [entryMode, setEntryMode] = useState(PROFILE_ENTRY_MODES.ENTER_NAME);
  const [entryNotice, setEntryNotice] = useState(null);
  const [upgradePlayer, setUpgradePlayer] = useState(null);
  const [protectedClaim, setProtectedClaim] = useState(null);
  const [top10Code, setTop10Code] = useState('');
  const predictionCounts = useMemo(() => countBy(predictions, 'player_id'), [predictions]);
  const upgradeNameValidation = upgradePlayer ? validatePlayerFullName(name) : null;
  const upgradeTargetName = upgradeNameValidation?.valid ? upgradeNameValidation.name : '';
  const renameSummary = upgradePlayer && upgradeTargetName
    ? getRenameSummary({
      currentName: upgradePlayer.name,
      newName: upgradeTargetName,
      willRevealCode: protectedClaim?.action === 'rename' && !top10Code,
    })
    : null;

  const showNotice = (type, title, text) => setEntryNotice({ type, title, text });
  const resetEntryGuidance = () => {
    setEntryMode(PROFILE_ENTRY_MODES.ENTER_NAME);
    setEntryNotice(null);
  };
  const beginUpgrade = (existing) => {
    setMessage('');
    setError('');
    setUpgradePlayer(existing);
    setName(`${existing.name} `);
    setMatches([]);
    setProtectedClaim(null);
    setTop10Code('');
    setEntryMode(PROFILE_ENTRY_MODES.CONFIRM_RENAME);
    showNotice(
      'info',
      `We found your existing profile: ${existing.name}`,
      'Add your last name to keep the same profile, saved picks, leaderboard history, and Top 10 status.',
    );
  };

  const savePlayer = async (mode = 'auto') => {
    if (mode.startsWith('existing:')) {
      const existingId = mode.replace('existing:', '');
      const existing = players.find((item) => item.id === existingId && isPlayerActive(item));
      if (existing && !validatePlayerFullName(existing.name).valid) {
        beginUpgrade(existing);
        return;
      }
    }

    const entryState = getProfileEntryState({ inputName: name, players });
    const nameValidation = entryState.validation;
    const cleanName = nameValidation.name;
    setMessage('');
    setError('');
    setEntryNotice(null);
    if (!nameValidation.valid) {
      const singleNameMatches = entryState.matches;
      if (singleNameMatches.length) {
        setMatches(singleNameMatches);
        setProtectedClaim(null);
        setEntryMode(PROFILE_ENTRY_MODES.SINGLE_NAME_FOUND);
        showNotice(
          'info',
          `We found your existing profile: ${singleNameMatches[0].name}`,
          'Choose the profile below, then add your last name. This updates the same profile instead of creating a new one.',
        );
        return;
      }
      setEntryMode(PROFILE_ENTRY_MODES.ENTER_NAME);
      showNotice('warning', 'Full name needed', nameValidation.message);
      return;
    }

    const sameName = entryState.matches;
    if (sameName.length && mode === 'auto') {
      setMatches(sameName);
      setProtectedClaim(null);
      setEntryMode(PROFILE_ENTRY_MODES.EXISTING_PROFILE_FOUND);
      showNotice(
        'info',
        'A profile already exists with this full name',
        'Use the existing profile to keep its saved picks, or enter a different first and last name.',
      );
      return;
    }

    try {
      if (upgradePlayer) {
        const duplicateFullName = players.find(
          (item) =>
            item.id !== upgradePlayer.id &&
            isPlayerActive(item) &&
            normalizePlayerName(item.name) === normalizePlayerName(cleanName),
        );
        if (duplicateFullName) {
          setMatches([duplicateFullName]);
          setProtectedClaim(null);
          setEntryMode(PROFILE_ENTRY_MODES.EXISTING_PROFILE_FOUND);
          showNotice(
            'warning',
            'A profile already exists with this full name',
            'Choose the existing profile below or enter a different full name before updating.',
          );
          return;
        }

        const payload = await runTop10Request({
          action: 'rename',
          tournament_id: tournament.id,
          player_id: upgradePlayer.id,
          player_token: player?.id === upgradePlayer.id ? player.player_token : '',
          code: top10Code,
          name: cleanName,
        });
        const data = { ...payload.player, player_token: payload.player?.player_token || player?.player_token };
        setPlayer(data);
        setPlayers((current) => current.map((item) => (item.id === data.id ? { ...item, ...data, player_token: undefined } : item)));
        setUpgradePlayer(null);
        setProtectedClaim(null);
        setTop10Code('');
        await refresh();
        if (payload.protectionCode) {
          setTop10Protection({ protected: true, playerId: data.id, code: payload.protectionCode, statusLabel: 'Top 10' });
          setTop10Celebration(createTop10Celebration({
            player: data,
            code: payload.protectionCode,
            status: currentTop10Status,
            firstReveal: true,
          }));
        } else {
          setMessage(`Updated your profile to ${data.name}. Your picks are still saved.`);
        }
        navigate(buildRoute(routeBase, '/matches'));
        return;
      }

      if (mode.startsWith('existing:')) {
        const existingId = mode.replace('existing:', '');
        const existing = players.find((item) => item.id === existingId && isPlayerActive(item));
        if (!existing) throw new Error('That player was not found.');
        if (!validatePlayerFullName(existing.name).valid) {
          beginUpgrade(existing);
          return;
        }
        if (protectedClaim?.player?.id === existing.id) {
          const payload = await runTop10Request({
            action: 'verify',
            tournament_id: tournament.id,
            player_id: existing.id,
            code: top10Code,
          });
          const verifiedPlayer = payload.player || existing;
          setPlayer(verifiedPlayer);
          setPlayers((current) => current.map((item) => (item.id === verifiedPlayer.id ? { ...item, ...verifiedPlayer, player_token: undefined } : item)));
          setProtectedClaim(null);
          setTop10Code('');
          setMessage(`Welcome back, ${verifiedPlayer.name}.`);
          navigate(buildRoute(routeBase, '/matches'));
          return;
        }
        if (tournament?.id && player?.id !== existing.id) {
          const status = await runTop10Request({
            action: 'check',
            tournament_id: tournament.id,
            player_id: existing.id,
          });
          if (status.requiresCode) {
            setProtectedClaim({ player: existing });
            setTop10Code('');
            setEntryMode(PROFILE_ENTRY_MODES.PROTECTED_CODE_REQUIRED);
            showNotice(
              'warning',
              'This profile is protected',
              `Enter the 4-character code to prove ${existing.name} is your profile before continuing.`,
            );
            return;
          }
        }
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
      setPlayers((current) => [...current, { ...data, player_token: undefined }]);
      await refresh();
      setMessage(`Welcome, ${data.name}.`);
      navigate(buildRoute(routeBase, '/matches'));
    } catch (err) {
      if (isUniqueViolation(err)) {
        setEntryMode(PROFILE_ENTRY_MODES.EXISTING_PROFILE_FOUND);
        showNotice('warning', 'That name is already registered', 'Use the existing profile below or enter a different full name.');
        await refresh();
        return;
      }
      if (upgradePlayer && /top 10 code/i.test(err.message || '')) {
        setProtectedClaim({ player: upgradePlayer, action: 'rename' });
        setEntryMode(PROFILE_ENTRY_MODES.PROTECTED_CODE_REQUIRED);
        showNotice(
          /incorrect/i.test(err.message || '') ? 'error' : 'warning',
          /incorrect/i.test(err.message || '') ? 'Incorrect Top 10 code' : 'This profile is protected',
          /incorrect/i.test(err.message || '')
            ? 'Check the 4-character code and try again.'
            : `Enter the 4-character code to update ${upgradePlayer.name} without losing picks.`,
        );
        return;
      }
      setEntryMode(PROFILE_ENTRY_MODES.SAVE_ERROR);
      showNotice('error', 'Could not save profile', err.message || 'Could not save player.');
    }
  };

  const continueAsStoredPlayer = () => {
    const nameValidation = validatePlayerFullName(player?.name || '');
    setMessage('');
    setError('');
    setEntryNotice(null);
    if (!nameValidation.valid) {
      beginUpgrade(player);
      return;
    }
    navigate(buildRoute(routeBase, '/matches'));
  };

  return (
    <section className="hero">
      <div>
        <p className="eyebrow">Private friends group</p>
        <h1>Predict {tournament.name} scores.</h1>
        <p className="hero-copy">
          Enter your first and last name, pick match scores, then watch the leaderboard update as results are added.
        </p>
      </div>
      <div className="entry-panel">
        <ProfileEntrySteps mode={entryMode} />
        <label htmlFor="player-name">Full name</label>
        <input
          id="player-name"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setMatches([]);
            setProtectedClaim(null);
            setTop10Code('');
            if (upgradePlayer) {
              setEntryMode(PROFILE_ENTRY_MODES.CONFIRM_RENAME);
              showNotice(
                'info',
                `We found your existing profile: ${upgradePlayer.name}`,
                'Review the new full name below before updating this profile.',
              );
            } else {
              resetEntryGuidance();
            }
          }}
          placeholder="First Last"
          maxLength={40}
        />
        {upgradePlayer && (
          <div className="name-update-confirm" aria-live="polite">
            <strong>{renameSummary?.title || 'Update existing profile'}</strong>
            <span>
              Current name: <b>{upgradePlayer.name}</b>
            </span>
            {upgradeTargetName && (
              <span>
                New name: <b>{upgradeTargetName}</b>
              </span>
            )}
            <small>{renameSummary?.body || 'Your saved picks stay with this same profile.'}</small>
            <small>If this profile is Top 10 protected, we may show your private code after the update. Save it.</small>
            {renameSummary?.codeNote && <small>{renameSummary.codeNote}</small>}
          </div>
        )}
        <button className="primary" onClick={() => savePlayer()}>
          {getPrimaryProfileButtonLabel({ upgradePlayer, upgradeNameValidation, upgradeTargetName, protectedClaim })}
        </button>
        {entryNotice && <EntryNotice notice={entryNotice} />}
        {protectedClaim && (
          <div className="profile-action-card warning">
            <strong>{protectedClaim.action === 'rename' ? 'Protected name update' : 'Top 10 protected profile'}</strong>
            <span>
              {protectedClaim.action === 'rename'
                ? `Enter the code for ${protectedClaim.player.name} to update this protected profile. Your picks and leaderboard history stay attached.`
                : `Enter the code for ${protectedClaim.player.name} to prove this is your profile before continuing.`}
            </span>
            <input
              aria-label="Top 10 code"
              value={top10Code}
              onChange={(event) => setTop10Code(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4))}
              placeholder="A7K2"
              maxLength={4}
            />
            <button onClick={() => (protectedClaim.action === 'rename' ? savePlayer() : savePlayer(`existing:${protectedClaim.player.id}`))}>
              {protectedClaim.action === 'rename' ? 'Update name with code' : 'Unlock profile'}
            </button>
            <button className="ghost" onClick={() => {
              setProtectedClaim(null);
              setTop10Code('');
              setUpgradePlayer(null);
              setMatches([]);
              resetEntryGuidance();
            }}>
              Try another name
            </button>
          </div>
        )}
        {player && !upgradePlayer && (
          <button className="ghost" onClick={continueAsStoredPlayer}>
            Continue as {player.name}
          </button>
        )}
        {matches.length > 0 && (
          <div className="profile-action-card">
            <strong>{entryMode === PROFILE_ENTRY_MODES.SINGLE_NAME_FOUND ? 'We found your existing single-name profile' : 'A profile already exists with this full name'}</strong>
            <span>
              {entryMode === PROFILE_ENTRY_MODES.SINGLE_NAME_FOUND
                ? 'Choose the profile below, then add your last name. This keeps the same saved picks and leaderboard history.'
                : 'Choose the existing profile to keep its saved picks, or enter a different first and last name.'}
            </span>
            {matches.map((item) => (
              <ProfileChoiceButton
                key={item.id}
                player={item}
                predictionCounts={predictionCounts}
                onChoose={() => savePlayer(`existing:${item.id}`)}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function ProfileEntrySteps({ mode }) {
  const steps = [
    { key: 'name', label: 'Enter first and last name' },
    { key: 'review', label: 'Review existing profile' },
    { key: 'confirm', label: 'Confirm what happens next' },
  ];
  const activeIndex = mode === PROFILE_ENTRY_MODES.ENTER_NAME ? 0 :
    mode === PROFILE_ENTRY_MODES.SINGLE_NAME_FOUND || mode === PROFILE_ENTRY_MODES.EXISTING_PROFILE_FOUND ? 1 : 2;
  return (
    <div className="profile-steps" aria-label="Profile setup steps">
      {steps.map((step, index) => (
        <span key={step.key} className={index <= activeIndex ? 'active' : ''}>
          {index + 1}. {step.label}
        </span>
      ))}
    </div>
  );
}

function EntryNotice({ notice }) {
  return (
    <div className={`entry-notice ${notice.type}`} role={notice.type === 'error' ? 'alert' : 'status'}>
      <strong>{notice.title}</strong>
      <span>{notice.text}</span>
    </div>
  );
}

function ProfileChoiceButton({ player, predictionCounts, onChoose }) {
  const needsUpgrade = !validatePlayerFullName(player.name).valid;
  return (
    <button className="profile-choice-button" onClick={onChoose}>
      <span>
        <strong>{needsUpgrade ? `Add last name to ${player.name}` : `Use ${player.name}`}</strong>
        <small>{getProfilePickHint(player, predictionCounts)}</small>
      </span>
      <em>{needsUpgrade ? 'Keeps same profile' : 'Continue with this profile'}</em>
    </button>
  );
}

function getPrimaryProfileButtonLabel({ upgradePlayer, upgradeNameValidation, upgradeTargetName, protectedClaim }) {
  if (upgradePlayer && upgradeNameValidation?.valid) {
    if (protectedClaim?.action === 'rename') return 'Update name with Top 10 code';
    return `Update this profile to ${upgradeTargetName}`;
  }
  if (upgradePlayer) return 'Review full name';
  return 'Check profile';
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
  const publishedMatches = useMemo(() => matches.filter(isPlayerFacingMatch), [matches]);
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
      if (!isPublicStatsPlayer(predictedPlayer)) return;
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
  const visibleMatchGroups = useMemo(() => groupMatchesByKsaDay(visibleMatches), [visibleMatches]);
  const [expandedMatchDayKeys, setExpandedMatchDayKeys] = useState(() => new Set());
  const liveLeaderboard = useMemo(
    () => calculateLiveLeaderboard(players, matches, predictions),
    [players, matches, predictions],
  );
  const refreshInterval = getMatchesRefreshInterval(publishedMatches);

  useEffect(() => {
    const groupKeys = new Set(visibleMatchGroups.map((group) => group.key));
    const defaultKey = visibleMatchGroups[0]?.key || '';
    setExpandedMatchDayKeys((current) => {
      const retainedKeys = [...current].filter((key) => groupKeys.has(key));
      if (retainedKeys.length) return new Set(retainedKeys);
      return defaultKey ? new Set([defaultKey]) : new Set();
    });
  }, [visibleMatchGroups]);

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
    if (targetMatch) {
      if (isMatchPlayed(targetMatch)) setMatchView('played');
      setExpandedMatchDayKeys((current) => new Set([...current, getKsaDayKey(targetMatch.kickoff_time)]));
    }
    window.setTimeout(() => {
      document.getElementById(`match-${targetId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 50);
  }, [publishedMatches]);

  const toggleMatchDay = (dayKey) => {
    setExpandedMatchDayKeys((current) => {
      const next = new Set(current);
      if (next.has(dayKey)) next.delete(dayKey);
      else next.add(dayKey);
      return next;
    });
  };

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
      <MatchDayGroups
        groups={visibleMatchGroups}
        expandedKeys={expandedMatchDayKeys}
        onToggle={toggleMatchDay}
        renderMatch={(match) => (
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
        )}
      />
      {!publishedMatches.length && <EmptyState text="No published matches yet. Ask the admin to import or add fixtures." />}
      {publishedMatches.length > 0 && !visibleMatches.length && (
        <EmptyState
          text={matchView === 'played' ? 'No played matches yet.' : 'No upcoming matches left.'}
        />
      )}
    </section>
  );
}

function MatchDayGroups({ groups, expandedKeys, onToggle, renderMatch }) {
  if (!groups.length) return null;

  return (
    <div className="match-day-list">
      {groups.map((group) => {
        const expanded = expandedKeys.has(group.key);
        return (
          <section className="match-day-group" key={group.key}>
            <button
              className="match-day-header"
              onClick={() => onToggle(group.key)}
              aria-expanded={expanded}
            >
              <span>
                <strong>{group.label}</strong>
                <small>KSA local time</small>
              </span>
              <em>{group.matches.length} match{group.matches.length === 1 ? '' : 'es'}</em>
            </button>
            {expanded && (
              <div className="match-list">
                {group.matches.map((match) => renderMatch(match))}
              </div>
            )}
          </section>
        );
      })}
    </div>
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
  const [saving, setSaving] = useState(false);
  const [localStatus, setLocalStatus] = useState(null);
  const [localSavedPrediction, setLocalSavedPrediction] = useState(null);
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
  const displayedSubmittedPredictions = useMemo(() => {
    const byPlayer = new Map(submittedPredictions.map((item) => [item.player_id, item]));
    [prediction, localSavedPrediction].forEach((item) => {
      if (item?.player_id === player?.id) byPlayer.set(item.player_id, item);
    });
    return [...byPlayer.values()].sort((a, b) =>
      getPlayerDisplayName(playersById.get(a.player_id)).localeCompare(
        getPlayerDisplayName(playersById.get(b.player_id)),
      ),
    );
  }, [submittedPredictions, prediction, localSavedPrediction, player?.id, playersById]);

  useEffect(() => {
    setTeamAScore(prediction?.predicted_team_a_score ?? '');
    setTeamBScore(prediction?.predicted_team_b_score ?? '');
  }, [prediction?.id, prediction?.predicted_team_a_score, prediction?.predicted_team_b_score]);

  useEffect(() => {
    setLocalSavedPrediction(null);
  }, [match.id, player?.id]);

  const submit = async () => {
    if (saving) return;
    setMessage('');
    setError('');
    setLocalStatus(null);
    const scoreA = parseScore(teamAScore);
    const scoreB = parseScore(teamBScore);
    if (locked) {
      const message = 'Predictions are locked for this match.';
      setLocalStatus({ type: 'error', text: message });
      setError(message);
      return;
    }
    if (scoreA === null || scoreB === null) {
      const message = 'Scores must be non-negative whole numbers.';
      setLocalStatus({ type: 'error', text: message });
      setError(message);
      return;
    }
    setSaving(true);
    try {
      const savedPrediction = await savePrediction({
        player,
        match,
        tournament,
        scoreA,
        scoreB,
      });
      setLocalSavedPrediction({
        id: savedPrediction?.id || prediction?.id || `local-${player.id}-${match.id}`,
        player_id: player.id,
        match_id: match.id,
        predicted_team_a_score: scoreA,
        predicted_team_b_score: scoreB,
        submitted_at: savedPrediction?.submitted_at || prediction?.submitted_at || new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      setLocalStatus({ type: 'success', text: `Prediction saved: ${scoreA}-${scoreB}` });
      setMessage('Prediction saved.');
      await refresh();
    } catch (err) {
      const message = err.message || 'Could not save prediction.';
      setLocalStatus({ type: 'error', text: message });
      setError(message);
    } finally {
      setSaving(false);
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
      {hasResult && (
        <div className="final-score-card" aria-label={`Final score ${match.team_a_score} to ${match.team_b_score}`}>
          <span>Final score</span>
          <strong>{match.team_a_score} - {match.team_b_score}</strong>
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
      <div className="submitted-panel">
        <div className="submitted-header">
          <strong>Submitted by</strong>
          <span>{displayedSubmittedPredictions.length} player{displayedSubmittedPredictions.length === 1 ? '' : 's'}</span>
        </div>
        {displayedSubmittedPredictions.length > 0 ? (
          <div className="submitted-list">
            {displayedSubmittedPredictions.map((submittedPrediction) => (
              <span key={submittedPrediction.id || `${submittedPrediction.player_id}-${submittedPrediction.match_id}`}>
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
      <div className="prediction-submit-row">
        <button className={`primary prediction-submit-button${localStatus?.type === 'success' ? ' saved' : ''}`} onClick={submit} disabled={locked || saving}>
          {saving ? 'Saving...' : prediction ? 'Update prediction' : 'Submit prediction'}
        </button>
        {localStatus && (
          <p
            className={`prediction-submit-status ${localStatus.type}`}
            role={localStatus.type === 'error' ? 'alert' : undefined}
            aria-live={localStatus.type === 'success' ? 'polite' : undefined}
          >
            {localStatus.text}
          </p>
        )}
      </div>
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
  if (!team?.flag_url) return <span className="flag-placeholder" title={team?.name || ''} aria-hidden="true">{(team?.name || '?').slice(0, 2).toUpperCase()}</span>;
  return <img className="team-flag" src={team.flag_url} alt={`${team.name} flag`} title={team.name} loading="lazy" />;
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
  const keyEventGroups = groupKeyEvents(events);
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
          <div className="event-groups">
            {keyEventGroups.map((group) => (
              <section className={`event-priority-group event-priority-${group.key}`} key={group.key}>
                <div className="event-priority-heading">
                  <EventGroupIcon icon={group.icon} />
                  <span>{group.label}</span>
                  <strong>{group.count}</strong>
                </div>
                <div className="event-list">
                  {group.events.map((event) => <EventChip key={event.id} event={event} teams={teams} />)}
                </div>
              </section>
            ))}
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
  const team = event.team_name ? teamIdentity(event.team_name, teams) : null;
  const visual = getEventVisual(event);
  return (
    <span className={`event-chip event-${visual.kind}`} title={buildEventTitle(event)}>
      <span className="event-icon" aria-hidden="true">
        {visual.card ? <span className={`event-card-icon ${visual.card}`} /> : visual.icon}
      </span>
      <strong className="event-minute">{minute}</strong>
      {team && <TeamFlag team={team} />}
      <span className="event-main">
        <strong>{visual.primary}</strong>
        {visual.secondary && <small>{visual.secondary}</small>}
      </span>
    </span>
  );
}

function EventGroupIcon({ icon }) {
  if (icon === 'red-card' || icon === 'yellow-card') {
    return (
      <span className="event-group-icon" aria-hidden="true">
        <span className={`event-card-icon ${icon === 'red-card' ? 'red' : 'yellow'}`} />
      </span>
    );
  }
  if (icon === 'var') {
    return <span className="event-group-icon event-group-icon-var" aria-hidden="true">VAR</span>;
  }
  return <span className="event-group-icon" aria-hidden="true">↕</span>;
}

function getEventVisual(event) {
  const type = String(event.event_type || '').toLowerCase();
  const detail = String(event.event_detail || '').toLowerCase();
  const player = event.player_name || formatEventType(event.event_type);
  const assist = event.assist_name || '';
  if (type.includes('subst')) {
    return {
      kind: 'substitution',
      icon: '↕',
      primary: assist ? `↑ ${assist}` : 'Sub',
      secondary: player ? `↓ ${player}` : '',
    };
  }
  if (type.includes('card') || detail.includes('card')) {
    const red = detail.includes('red');
    return {
      kind: red ? 'red-card' : 'yellow-card',
      card: red ? 'red' : 'yellow',
      primary: player,
      secondary: '',
    };
  }
  if (type.includes('var')) {
    return {
      kind: 'var',
      icon: 'VAR',
      primary: formatEventDetail(event.event_detail || event.event_type),
      secondary: player && !/^var$/i.test(player) ? player : '',
    };
  }
  if (/penalty/i.test(event.event_detail || '')) {
    return {
      kind: 'penalty',
      icon: '●',
      primary: player,
      secondary: /missed/i.test(event.event_detail || '') ? 'Missed' : '',
    };
  }
  if (/goal/i.test(`${event.event_type || ''} ${event.event_detail || ''}`)) {
    const detailLabel = formatEventDetail(event.event_detail);
    const showDetail = detailLabel && !/^goal$/i.test(detailLabel);
    return {
      kind: 'goal',
      icon: '⚽',
      primary: player,
      secondary: assist ? `A: ${assist}` : showDetail ? detailLabel : '',
    };
  }
  return {
    kind: 'generic',
    icon: '•',
    primary: player,
    secondary: event.event_detail ? formatEventDetail(event.event_detail) : '',
  };
}

function buildEventTitle(event) {
  const parts = [
    event.team_name,
    event.elapsed !== null && event.elapsed !== undefined ? `${event.elapsed}${event.extra_time ? `+${event.extra_time}` : ''}'` : '',
    formatEventType(event.event_type),
    event.player_name,
    event.assist_name ? `Involved: ${event.assist_name}` : '',
    event.event_detail ? formatEventDetail(event.event_detail) : '',
  ].filter(Boolean);
  return parts.join(' · ');
}

function LeaderboardPage({ players, matches, predictions, predictionAids, matchOdds, refresh }) {
  const publicPlayers = players.filter(isPublicStatsPlayer);
  const rows = calculateLeaderboard(publicPlayers, matches, predictions);
  const visibleRows = rows.filter((row) => row.predictions_submitted_count > 0);
  const liveRows = calculateLiveLeaderboard(publicPlayers, matches, predictions);
  const stylesByPlayer = useMemo(
    () => buildPredictionStylesByPlayer({ players: publicPlayers, matches, predictions, predictionAids, matchOdds }),
    [publicPlayers, matches, predictions, predictionAids, matchOdds],
  );
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
            {visibleRows.map((row, index) => {
              const rank = index + 1;
              const rankStatus = getLeaderboardRankStatus(rank);
              return (
                <tr
                  className={rankStatus ? `leaderboard-row leaderboard-${rankStatus.key}` : 'leaderboard-row'}
                  key={row.player_id}
                >
                  <td>
                    <span className="leaderboard-rank">
                      <strong>#{rank}</strong>
                      {rankStatus && <span className="leaderboard-status">{rankStatus.label}</span>}
                    </span>
                  </td>
                  <td>
                    <span className="leaderboard-player">
                      <span className="leaderboard-player-main">
                        <PredictionStyleBadge style={stylesByPlayer.get(row.player_id)} size="small" />
                        <strong>{row.name}</strong>
                      </span>
                      {rankStatus?.key === 'leader' && <span>Current top player</span>}
                      {rankStatus?.key === 'top10' && <span>{rankStatus.shortLabel}</span>}
                    </span>
                  </td>
                  <td><strong>{row.total_points}</strong></td>
                  <td>{liveRows.get(row.player_id)?.live_points || 0}</td>
                  <td>{row.exact_score_count}</td>
                  <td>{row.correct_outcome_count}</td>
                  <td>{row.predictions_submitted_count}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!visibleRows.length && <EmptyState text="Leaderboard will appear after the first prediction is submitted." />}
    </section>
  );
}

function Top10CelebrationModal({ celebration, onClose }) {
  const [copied, setCopied] = useState(false);
  const statusLabel = celebration.statusLabel || 'Top 10';
  const rankText = celebration.rank ? `${statusLabel}: #${celebration.rank}` : 'Protected Top 10 status';
  const copyCode = async () => {
    if (!celebration.code) return;
    try {
      await navigator.clipboard.writeText(celebration.code);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="top10-modal" role="dialog" aria-modal="true" aria-labelledby="top10-title">
        <p className="top10-kicker">Top 10 protected list</p>
        <h1 id="top10-title">You made the Top 10</h1>
        <div className="top10-rank-pill">{rankText}</div>
        <p className="top10-player-line">
          {celebration.playerName}, you are now on the protected {statusLabel} list.
        </p>
        {celebration.code && (
          <div className="top10-code-actions">
            <div className="top10-code-display" aria-label="Top 10 protection code">
              {celebration.code}
            </div>
            <button onClick={copyCode}>{copied ? 'Copied' : 'Copy code'}</button>
          </div>
        )}
        <p>
          This code protects your profile so nobody on another browser can claim your name, picks, and Top 10 status.
        </p>
        <p className="muted">Your picks and leaderboard history stay with this same profile.</p>
        <button className="primary" onClick={onClose}>I saved my code</button>
      </section>
    </div>
  );
}

function Top10CodePage({
  player,
  storedPlayer,
  tournament,
  currentTop10Status,
  top10Protection,
  setTop10Protection,
  setTop10Celebration,
  navigate,
  routeBase,
}) {
  const [loadingCode, setLoadingCode] = useState(false);
  const [codeError, setCodeError] = useState('');
  const code = top10Protection?.playerId === storedPlayer?.id ? top10Protection?.code || '' : '';

  useEffect(() => {
    if (!tournament?.id || !storedPlayer?.id || !storedPlayer?.player_token || code) return;
    let cancelled = false;
    const loadCode = async () => {
      setLoadingCode(true);
      setCodeError('');
      try {
        const payload = await runTop10Request({
          action: 'reveal',
          tournament_id: tournament.id,
          player_id: storedPlayer.id,
          player_token: storedPlayer.player_token,
        });
        if (cancelled) return;
        if (payload.protected && payload.code) {
          setTop10Protection({ protected: true, playerId: storedPlayer.id, code: payload.code, statusLabel: payload.status_label || 'Top 10' });
        } else {
          setTop10Protection({ protected: false, playerId: storedPlayer.id });
        }
      } catch (err) {
        if (!cancelled) setCodeError(err.message || 'Could not load your Top 10 code.');
      } finally {
        if (!cancelled) setLoadingCode(false);
      }
    };
    loadCode();
    return () => {
      cancelled = true;
    };
  }, [tournament?.id, storedPlayer?.id, storedPlayer?.player_token, code, setTop10Protection]);

  if (!player && !storedPlayer) return <NeedPlayer navigate={navigate} routeBase={routeBase} />;

  const displayPlayer = player || storedPlayer;
  const openCelebration = () => {
    setTop10Celebration(createTop10Celebration({
      player: displayPlayer,
      code,
      status: currentTop10Status,
      firstReveal: false,
    }));
  };

  return (
    <section className="top10-code-page">
      <PageTitle title="My code" />
      <div className="panel top10-code-panel">
        <p className="top10-kicker">Private Top 10 protection</p>
        <h2>{displayPlayer?.name || 'Your profile'}</h2>
        {currentTop10Status ? (
          <div className="top10-rank-pill">{currentTop10Status.status_label}: #{currentTop10Status.rank}</div>
        ) : (
          <div className="top10-rank-pill muted-pill">Protected status saved</div>
        )}
        <p>
          Your code protects your profile, picks, leaderboard history, and earned Top 10 status when someone tries to use this profile from another browser or device.
        </p>
        {loadingCode && <p className="muted">Loading your private code...</p>}
        {code && <div className="top10-code-display">{code}</div>}
        {!loadingCode && !code && !codeError && (
          <p className="muted">
            This browser can see your current Top 10 rank, but it does not have the private code saved yet. Open the Top 10 badge after redeploy, or ask the admin to reset/reveal your code if this profile was upgraded before code saving was available.
          </p>
        )}
        {codeError && <p className="entry-error">{codeError}</p>}
        {code && <button className="primary" onClick={openCelebration}>Open Top 10 status</button>}
      </div>
    </section>
  );
}

function StatsPage({
  player,
  storedPlayer,
  players,
  matches,
  predictions,
  predictionAids,
  matchOdds,
  tournament,
  currentTop10Status,
  top10Protection,
  setTop10Protection,
  setTop10Celebration,
  refresh,
  navigate,
  routeBase,
}) {
  const [loadingCode, setLoadingCode] = useState(false);
  const [codeError, setCodeError] = useState('');
  const displayPlayer = player || storedPlayer;
  const stats = useMemo(
    () => buildPlayerStats({
      playerId: displayPlayer?.id,
      players,
      matches,
      predictions,
    }),
    [displayPlayer?.id, players, matches, predictions],
  );
  const predictionStyle = useMemo(
    () => buildPredictionStyle({
      playerId: displayPlayer?.id,
      players,
      matches,
      predictions,
      predictionAids,
      matchOdds,
    }),
    [displayPlayer?.id, players, matches, predictions, predictionAids, matchOdds],
  );
  const code = top10Protection?.playerId === storedPlayer?.id ? top10Protection?.code || '' : '';
  const canRevealCode = Boolean(tournament?.id && storedPlayer?.id && storedPlayer?.player_token);
  const showProtectedPanel = Boolean(currentTop10Status || top10Protection?.protected || code);

  if (!displayPlayer) return <NeedPlayer navigate={navigate} routeBase={routeBase} />;
  if (player && !isPlayerActive(player)) return <InactivePlayer navigate={navigate} routeBase={routeBase} />;

  const revealCode = async () => {
    if (!canRevealCode) {
      setCodeError('This browser cannot reveal the code. Use the browser where the profile was created or ask the admin to reset it.');
      return;
    }
    setLoadingCode(true);
    setCodeError('');
    try {
      const payload = await runTop10Request({
        action: 'reveal',
        tournament_id: tournament.id,
        player_id: storedPlayer.id,
        player_token: storedPlayer.player_token,
      });
      if (payload.protected && payload.code) {
        setTop10Protection({ protected: true, playerId: storedPlayer.id, code: payload.code, statusLabel: payload.status_label || 'Top 10' });
      } else {
        setTop10Protection({ protected: false, playerId: storedPlayer.id });
        setCodeError('This profile is not currently protected by a Top 10 code.');
      }
    } catch (err) {
      setCodeError(err.message || 'Could not load your Top 10 code.');
    } finally {
      setLoadingCode(false);
    }
  };

  const openCelebration = () => {
    setTop10Celebration(createTop10Celebration({
      player: displayPlayer,
      code,
      status: currentTop10Status,
      firstReveal: false,
    }));
  };

  return (
    <section className="stats-page">
      <PageTitle title="My Stats" action={<button onClick={refresh}>Refresh</button>} />
      <section className="stats-hero panel">
        <div>
          <p className="eyebrow">Personal dashboard</p>
          <h1>{displayPlayer.name}</h1>
          <p className="muted">
            {stats.rank ? `Rank #${stats.rank} of ${stats.totalPlayers} players with picks.` : 'Submit your first pick to enter the leaderboard.'}
          </p>
          {displayPlayer.hidden_from_public_stats && (
            <p className="hidden-stats-note">Hidden from public stats. Your private rank and history stay visible here.</p>
          )}
        </div>
        <div className="stats-rank-card">
          <span>{currentTop10Status?.status_label || 'Current rank'}</span>
          <strong>{stats.rank ? `#${stats.rank}` : '-'}</strong>
          <em>{stats.row.total_points} points</em>
        </div>
      </section>

      <div className="stats-kpi-grid">
        <StatsKpiCard label="Points" value={stats.row.total_points} detail={`${stats.livePoints} live`} />
        <StatsKpiCard label="Picks" value={stats.picksSubmitted} detail={`${stats.openPicksRemaining} open`} />
        <StatsKpiCard label="Completion" value={`${stats.completionRate}%`} detail="published matches" />
        <StatsKpiCard label="Exact scores" value={stats.exactScoreCount} detail={`${stats.exactRate}% exact rate`} />
        <StatsKpiCard label="Outcomes" value={stats.correctOutcomeCount} detail={`${stats.accuracyRate}% scoring picks`} />
        <StatsKpiCard label="Missed" value={stats.zeroPointCount} detail="zero-point picks" />
        <StatsKpiCard label="Avg points" value={stats.averagePointsPerCompletedPick} detail="per completed pick" />
      </div>

      <PredictionStylePanel style={predictionStyle} />

      <div className="stats-layout">
        <section className="panel stats-comparison-panel">
          <h2>Against the family</h2>
          <ComparisonBar label="Points" value={stats.row.total_points} average={stats.comparison.groupAveragePoints} />
          <ComparisonBar label="Picks" value={stats.picksSubmitted} average={stats.comparison.groupAveragePicks} />
          <ComparisonBar label="Exact" value={stats.exactScoreCount} average={stats.comparison.groupAverageExact} />
          <ComparisonBar label="Accuracy" value={stats.accuracyRate} average={stats.comparison.groupAverageAccuracy} suffix="%" />
          <div className="stats-distance-grid">
            <span><strong>{stats.comparison.pointsBehindLeader}</strong> behind leader</span>
            <span><strong>{stats.comparison.pointsBehindRankAbove}</strong> behind rank above</span>
            <span><strong>{stats.comparison.pointsToTop10}</strong> to Top 10</span>
          </div>
        </section>

        <section className="panel stats-form-panel">
          <h2>Recent form</h2>
          {stats.recentForm.length > 0 ? (
            <div className="form-chip-list">
              {stats.recentForm.map((result) => (
                <span className={`form-chip points-${result.points}`} key={result.prediction.id}>
                  <strong>{result.points}</strong>
                  {result.match.team_a} {result.match.team_a_score}-{result.match.team_b_score} {result.match.team_b}
                </span>
              ))}
            </div>
          ) : (
            <p className="muted">Completed-pick form appears after your picked matches finish.</p>
          )}
          {stats.bestResult && (
            <div className="best-result-card">
              <span>Best result</span>
              <strong>{stats.bestResult.points} points</strong>
              <em>{stats.bestResult.match.team_a} vs {stats.bestResult.match.team_b}</em>
            </div>
          )}
        </section>
      </div>

      <div className="stats-layout">
        <section className="panel">
          <h2>Nearby leaderboard</h2>
          {stats.nearbyLeaderboard.length > 0 ? (
            <div className="nearby-list">
              {stats.nearbyLeaderboard.map((row) => (
                <div className={row.isCurrentPlayer ? 'current' : ''} key={row.player_id}>
                  <span>#{row.rank}</span>
                  <strong>{row.name}</strong>
                  <em>{row.total_points} pts</em>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">You will appear here after your first submitted pick.</p>
          )}
        </section>

        <section className="panel stats-next-panel">
          <h2>Next action</h2>
          {stats.upcomingGaps.length > 0 ? (
            <>
              <p className="muted">Matches still waiting for your prediction.</p>
              <div className="upcoming-gap-list">
                {stats.upcomingGaps.map((match) => (
                  <button key={match.id} onClick={() => navigate(`${buildRoute(routeBase, '/matches')}#match-${match.id}`)}>
                    <strong>{match.team_a} vs {match.team_b}</strong>
                    <span>{formatDate(match.kickoff_time)}</span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <p className="muted">No open prediction gaps right now.</p>
          )}
        </section>
      </div>

      {showProtectedPanel && (
        <section className="panel stats-code-panel">
          <div>
            <p className="top10-kicker">Protected profile</p>
            <h2>{currentTop10Status ? `${currentTop10Status.status_label} #${currentTop10Status.rank}` : 'Top 10 code'}</h2>
            <p className="muted">Your private code protects this profile, picks, leaderboard history, and earned status on new browsers.</p>
          </div>
          {loadingCode && <p className="muted">Loading your private code...</p>}
          {code && <div className="top10-code-display">{code}</div>}
          {codeError && <p className="entry-error">{codeError}</p>}
          <div className="button-row">
            {!code && <button onClick={revealCode} disabled={loadingCode}>{loadingCode ? 'Loading...' : 'Reveal my code'}</button>}
            {code && <button className="primary" onClick={openCelebration}>Open Top 10 status</button>}
          </div>
        </section>
      )}
    </section>
  );
}

function StatsKpiCard({ label, value, detail }) {
  return (
    <article className="stats-kpi-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <em>{detail}</em>
    </article>
  );
}

function PredictionStylePanel({ style }) {
  return (
    <section className={`panel prediction-style-panel style-${style.key}`}>
      <div className="prediction-style-hero">
        <PredictionStyleBadge style={style} size="large" />
        <div>
          <p className="eyebrow">Prediction style</p>
          <h2>{style.label}</h2>
          <p className="muted">{style.tone} pattern. {style.mindset}</p>
          {style.provisional && (
            <p className="prediction-style-note">
              Provisional label. It becomes more reliable after 5 submitted picks.
            </p>
          )}
        </div>
      </div>
      <div className="prediction-style-copy">
        <div>
          <span>Strength</span>
          <strong>{style.strength}</strong>
        </div>
        <div>
          <span>Possible blind spot</span>
          <strong>{style.blindSpot}</strong>
        </div>
      </div>
      <div className="prediction-style-metrics">
        <span><strong>{style.metrics.favoriteAlignment}%</strong> favorite alignment</span>
        <span><strong>{style.metrics.underdogRate}%</strong> against favorite</span>
        <span><strong>{style.metrics.consensusDistance}%</strong> from family consensus</span>
        <span><strong>{style.metrics.averagePredictedMargin}</strong> avg goal margin</span>
        <span><strong>{style.metrics.drawRate}%</strong> draw picks</span>
        <span><strong>{style.relativeScore}</strong> group risk percentile</span>
      </div>
      <details className="prediction-style-explainer">
        <summary>How this is calculated</summary>
        <p>
          This style compares your submitted picks with available favorite signals, the family&apos;s most common
          prediction outcome, your predicted goal margins, draw frequency, and scoreline variance. The final badge
          is relative to this family&apos;s prediction patterns, so it shows how your style compares with the group.
        </p>
        <p>
          Favorite alignment means choosing the team favored by available match insight or odds data. Consensus
          distance means how often your predicted outcome differs from the family&apos;s most common pick for that
          match, excluding your own pick. Boldness comes from underdog picks, draws, wider margins, and variable
          scorelines.
        </p>
        <p>
          The labels are based on prediction behavior under uncertainty, inspired by prospect theory,
          favourite-longshot bias research, and prediction-market calibration work. They are not personality
          judgments or betting advice.
        </p>
      </details>
      <div className="prediction-style-all">
        <h3>All styles</h3>
        <div>
          {Object.values(PREDICTION_STYLES).map((item) => (
            <article key={item.key}>
              <PredictionStyleBadge style={item} size="small" />
              <strong>{item.label}</strong>
              <span>{item.tone}</span>
              <p>{item.strength}</p>
              <em>{item.blindSpot}</em>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function PredictionStyleBadge({ style, size = 'small' }) {
  if (!style) return null;
  return (
    <span
      className={`prediction-style-badge ${size} style-${style.key}`}
      title={`${style.label}: ${style.tone}`}
      aria-label={`${style.label}: ${style.tone}`}
    >
      <AnimalEmblem styleKey={style.key} />
    </span>
  );
}

function AnimalEmblem({ styleKey }) {
  if (styleKey === 'shield_turtle') {
    return (
      <svg viewBox="0 0 80 80" aria-hidden="true">
        <path className="emblem-shadow" d="M20 62c9 6 29 7 42-1" />
        <path className="emblem-fill alt" d="M18 44c0-17 12-29 29-29 13 0 23 9 23 22 0 18-14 31-33 31-12 0-19-9-19-24Z" />
        <path className="emblem-fill" d="M25 39c4-12 13-19 25-18 8 1 14 7 15 15-9 1-20 5-29 14-6-2-10-6-11-11Z" />
        <path className="emblem-accent" d="M32 38c4-7 10-11 18-11M38 50c6-7 15-12 26-14" />
        <path className="emblem-fill" d="M63 34l10-6 3 8-9 8M21 49 9 52l4 8 12-5M35 64l-3 10h11l2-10" />
        <circle className="emblem-eye" cx="59" cy="29" r="3" />
        <path className="emblem-smile" d="M55 40c3 2 7 2 10-1" />
      </svg>
    );
  }
  if (styleKey === 'falcon_striker') {
    return (
      <svg viewBox="0 0 80 80" aria-hidden="true">
        <path className="emblem-shadow" d="M16 64c11 5 34 5 49-1" />
        <path className="emblem-fill" d="M14 47c17-23 34-34 55-31-7 7-13 14-18 22 8-3 15-3 21 1-15 3-28 10-39 23 1-8 4-15 9-23-8 3-17 6-28 8Z" />
        <path className="emblem-fill alt" d="M40 21c9 4 16 11 19 20l-19-2-12 11c1-13 5-22 12-29Z" />
        <path className="emblem-accent" d="M43 29c5 3 9 7 12 13M37 44l17 8" />
        <path className="emblem-beak" d="M57 22 72 13l-5 15Z" />
        <circle className="emblem-eye" cx="52" cy="27" r="3" />
        <path className="emblem-smile" d="M49 34c4 1 8 0 11-3" />
      </svg>
    );
  }
  if (styleKey === 'lone_wolf') {
    return (
      <svg viewBox="0 0 80 80" aria-hidden="true">
        <path className="emblem-shadow" d="M17 66c12 6 34 6 47-1" />
        <path className="emblem-fill alt" d="M16 56 10 28l17 8 13-22 13 22 17-8-6 28-24 12-24-12Z" />
        <path className="emblem-fill" d="M24 53c4-12 10-19 16-20 7 1 13 8 16 20l-16 9-16-9Z" />
        <path className="emblem-accent" d="m29 43 8 5-11 6M51 43l-8 5 11 6" />
        <circle className="emblem-eye" cx="32" cy="37" r="3" />
        <circle className="emblem-eye" cx="48" cy="37" r="3" />
        <path className="emblem-nose" d="M36 53h8l-4 5Z" />
        <path className="emblem-smile" d="M32 59c5 3 11 3 16 0" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 80 80" aria-hidden="true">
      <path className="emblem-shadow" d="M14 63c13 6 36 6 52 0" />
      <path className="emblem-fill" d="M13 48c10-25 27-37 52-35-4 6-9 12-16 19l17 2c-8 9-18 15-31 16l-8 14-5-12-9-4Z" />
      <path className="emblem-fill alt" d="M30 25c9 3 16 9 19 18l-18 4-9-4c1-8 4-14 8-18Z" />
      <path className="emblem-accent" d="M35 30c6 3 10 8 13 14M26 52 14 66M42 51l6 14" />
      <circle className="emblem-eye" cx="47" cy="25" r="3" />
      <path className="emblem-nose" d="M54 21 66 11l-4 14Z" />
      <path className="emblem-smile" d="M41 35c5 2 10 1 14-3" />
    </svg>
  );
}

function ComparisonBar({ label, value, average, suffix = '' }) {
  const max = Math.max(Number(value) || 0, Number(average) || 0, 1);
  return (
    <div className="comparison-row">
      <div>
        <strong>{label}</strong>
        <span>You {value}{suffix} / Avg {average}{suffix}</span>
      </div>
      <div className="comparison-bars" aria-hidden="true">
        <span className="you" style={{ width: `${Math.max(6, ((Number(value) || 0) / max) * 100)}%` }} />
        <span className="average" style={{ width: `${Math.max(6, ((Number(average) || 0) / max) * 100)}%` }} />
      </div>
    </div>
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

function BracketPage({ matches, teams, refresh, navigate, routeBase }) {
  const bracket = useMemo(() => buildBracket(matches), [matches]);

  return (
    <section className="bracket-page">
      <PageTitle title="Bracket" action={<button onClick={refresh}>Refresh</button>} />
      <p className="muted">
        FIFA World Cup 2026 knockout path: 32 teams, five champion rounds, and a separate third-place match.
      </p>
      {!bracket.hasRealMatches && (
        <div className="banner bracket-template-note">
          Showing the official bracket template. Teams, venues, and match links will activate as knockout fixtures are imported.
        </div>
      )}
      <div className="bracket-scroll" aria-label="Knockout bracket">
        <div className="bracket-grid">
          {bracket.rounds.map((round) => (
            <section className="bracket-round" key={round.key} aria-labelledby={`bracket-${round.key}`}>
              <div className="bracket-round-title">
                <h2 id={`bracket-${round.key}`}>{round.label}</h2>
                <span>{round.matches.length}</span>
              </div>
              <div className="bracket-match-list">
                {round.matches.map((match) => (
                  <BracketMatchNode
                    key={match.id}
                    match={match}
                    teams={teams}
                    slots={bracket.slots}
                    navigate={navigate}
                    routeBase={routeBase}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
      <section className="third-place-panel" aria-labelledby="third-place-title">
        <div className="section-heading">
          <h2 id="third-place-title">Third-place match</h2>
          <span>Official side match</span>
        </div>
        <div className="bracket-third-list">
          {bracket.thirdPlace.map((match) => (
            <BracketMatchNode
              key={match.id}
              match={match}
              teams={teams}
              slots={bracket.slots}
              navigate={navigate}
              routeBase={routeBase}
              compact
            />
          ))}
        </div>
      </section>
    </section>
  );
}

function BracketMatchNode({ match, teams, slots, navigate, routeBase, compact = false }) {
  const winner = getMatchWinner(match);
  const teamA = teamIdentity(match.team_a, teams);
  const teamB = teamIdentity(match.team_b, teams);
  const scoreReady = isFinalScoreComplete(match);
  const labelA = getTeamSeedLabel(match, 'A', slots);
  const labelB = getTeamSeedLabel(match, 'B', slots);
  const slotLabel = match.bracket_slot || match.external_match_id || 'Slot';
  const goToMatch = () => navigate(`${buildRoute(routeBase, '/matches')}#match-${match.id}`);
  const Wrapper = match.is_placeholder ? 'div' : 'button';
  const wrapperProps = match.is_placeholder ? {} : { onClick: goToMatch };

  return (
    <article className={`bracket-node ${compact ? 'compact' : ''}`}>
      <Wrapper className={`bracket-node-main ${match.is_placeholder ? 'placeholder' : ''}`} {...wrapperProps}>
        <span className="bracket-node-meta">
          <strong>{slotLabel}</strong>
          <span>{match.date_label || formatDate(match.kickoff_time)}</span>
        </span>
        <span className={`bracket-team ${winner?.side === 'A' ? 'winner' : ''}`}>
          <BracketTeamLabel match={match} team={teamA} label={labelA} />
          {scoreReady && <strong>{match.team_a_score}</strong>}
        </span>
        <span className={`bracket-team ${winner?.side === 'B' ? 'winner' : ''}`}>
          <BracketTeamLabel match={match} team={teamB} label={labelB} />
          {scoreReady && <strong>{match.team_b_score}</strong>}
        </span>
        <span className="bracket-node-foot">
          <span>{match.venue || 'Venue TBD'}</span>
          {match.winner_to_slot ? <em>Winner to {match.winner_to_slot}</em> : <em>{match.is_placeholder ? 'Fixture pending' : 'Match link'}</em>}
        </span>
      </Wrapper>
    </article>
  );
}

function BracketTeamLabel({ match, team, label }) {
  const realTeam = !match.is_placeholder && !isBracketSourceLabel(label);
  if (realTeam) {
    return (
      <span className="bracket-team-flag-only" title={label} aria-label={label}>
        <TeamFlag team={team} />
      </span>
    );
  }
  return <span title={label}>{label}</span>;
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

function PredictionsPage({ player, players, matches, predictions, teams, refresh, navigate, routeBase }) {
  const [matchView, setMatchView] = useState('upcoming');
  const [expandedMatchIds, setExpandedMatchIds] = useState(() => new Set());
  const [refreshState, setRefreshState] = useState('idle');
  const playersById = useMemo(() => new Map(players.map((player) => [player.id, player])), [players]);
  const activePlayerCount = useMemo(
    () => players.filter((player) => isPublicStatsPlayer(player)).length,
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

  const publishedMatches = matches.filter(isPlayerFacingMatch);
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
                currentPlayerId={player?.id}
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
                  currentPlayerId={player?.id}
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
  currentPlayerId,
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
    isPublicStatsPlayer(playersById.get(prediction.player_id)),
  ).length;
  const percent = activePlayerCount ? Math.round((activeSubmittedCount / activePlayerCount) * 100) : 0;
  const hasFinalScore = !live && isMatchPlayed(match) && isFinalScoreComplete(match);

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
          <div className="picks-summary-actions">
            {hasFinalScore && (
              <div className="picks-final-score" aria-label={`Final score ${match.team_a_score} to ${match.team_b_score}`}>
                <span>Final score</span>
                <strong>{match.team_a_score} - {match.team_b_score}</strong>
              </div>
            )}
            <button className="ghost picks-expand-button" onClick={onToggle} aria-expanded={expanded}>
              {expanded ? 'Hide picks' : 'Show picks'}
            </button>
          </div>
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
          currentPlayerId={currentPlayerId}
          activeSubmittedCount={activeSubmittedCount}
          activePlayerCount={activePlayerCount}
          canReveal={canReveal}
          live={live}
        />
      )}
    </article>
  );
}

function PicksTable({ match, matchPredictions, playersById, currentPlayerId, activeSubmittedCount, activePlayerCount, canReveal, live }) {
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
  const visiblePredictions = matchPredictions.filter((prediction) => {
    const predictedPlayer = playersById.get(prediction.player_id);
    return isPublicStatsPlayer(predictedPlayer) || prediction.player_id === currentPlayerId;
  });
  const rows = hasRankedScore
    ? [...visiblePredictions].sort((a, b) => {
        const pointsA = hasLiveScore ? livePredictionPoints(a, match) ?? -1 : predictionPoints(a, match);
        const pointsB = hasLiveScore ? livePredictionPoints(b, match) ?? -1 : predictionPoints(b, match);
        if (pointsA !== pointsB) return pointsB - pointsA;
        return getPlayerDisplayName(playersById.get(a.player_id)).localeCompare(
          getPlayerDisplayName(playersById.get(b.player_id)),
        );
      })
    : visiblePredictions;

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
      {visiblePredictions.length > 0 && (
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
      {visiblePredictions.length === 0 && (
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
  players,
  predictions,
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
    bracket_round: '',
    bracket_slot: '',
    bracket_side: '',
    winner_to_slot: '',
    winner_to_side: '',
    loser_to_slot: '',
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
        bracket_round: form.bracket_round?.trim() || null,
        bracket_slot: form.bracket_slot?.trim() || null,
        bracket_side: form.bracket_side?.trim() || null,
        winner_to_slot: form.winner_to_slot?.trim() || null,
        winner_to_side: form.winner_to_side?.trim() || null,
        loser_to_slot: form.loser_to_slot?.trim() || null,
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
      if (payload.bracket) {
        const bracketParts = [
          `bracket ${payload.bracket.concrete || 0} concrete`,
          `${payload.bracket.placeholders || 0} placeholders`,
        ];
        if (payload.bracket.providerFixtures) bracketParts.push(`${payload.bracket.providerFixtures} provider fixtures`);
        if (payload.bracket.providerMatched) bracketParts.push(`${payload.bracket.providerMatched} matched`);
        if (payload.bracket.missingVenueFixtures) bracketParts.push(`${payload.bracket.missingVenueFixtures} missing venues`);
        if (payload.bracket.unmatchedProviderFixtures?.length) {
          bracketParts.push(`${payload.bracket.unmatchedProviderFixtures.length} unmatched`);
        }
        parts.push(bracketParts.join(', '));
      }
      if (payload.live) {
        parts.push(`matches ${payload.live.synced || 0}, events ${payload.live.events || 0}, stats ${payload.live.statistics || 0}, top 10 new ${payload.live.top10?.created || 0}`);
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
      <FamilyStatsPanel
        tournament={tournament}
        players={players}
        matches={matches}
        predictions={predictions}
        favorites={scopedRows(allTeamFavorites, tournament)}
      />
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
      <Top10CodesPanel
        tournament={tournament}
        setMessage={setMessage}
        setError={setError}
      />
      <AdminPlayersPanel
        tournament={tournament}
        players={players}
        predictions={predictions}
        matches={matches}
        refresh={refresh}
        setMessage={setMessage}
        setError={setError}
      />
      <BracketHealthPanel matches={matches} />
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
          <div className="two-col">
            <AdminInput label="Bracket round" value={form.bracket_round || ''} onChange={(value) => setField('bracket_round', value)} />
            <AdminInput label="Bracket slot" value={form.bracket_slot || ''} onChange={(value) => setField('bracket_slot', value)} />
          </div>
          <div className="two-col">
            <AdminInput label="Winner to slot" value={form.winner_to_slot || ''} onChange={(value) => setField('winner_to_slot', value)} />
            <AdminInput label="Winner to side" value={form.winner_to_side || ''} onChange={(value) => setField('winner_to_side', value)} />
          </div>
          <div className="two-col">
            <AdminInput label="Bracket side" value={form.bracket_side || ''} onChange={(value) => setField('bracket_side', value)} />
            <AdminInput label="Loser to slot" value={form.loser_to_slot || ''} onChange={(value) => setField('loser_to_slot', value)} />
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
            <button onClick={() => runManualSync('bracket')} disabled={Boolean(syncing)}>
              {syncing === 'bracket' ? 'Syncing bracket...' : 'Sync bracket'}
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
              <AdminLockButton match={match} quickUpdate={quickUpdate} />
              <button className="danger" onClick={() => remove(match)}>Delete</button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function FamilyStatsPanel({ tournament, players, matches, predictions, favorites }) {
  const stats = getFamilyKpis({ players, matches, predictions, favorites });
  const topSubmitters = stats.topSubmitters.slice(0, 5);

  return (
    <section className="panel family-stats-panel">
      <div className="section-heading">
        <div>
          <h2>{tournament?.name || 'Family app'} stats</h2>
          <p className="muted">Current users and prediction activity for this app.</p>
        </div>
      </div>
      <div className="clone-kpis family-kpis">
        <span><strong>{stats.players}</strong> players</span>
        <span><strong>{stats.activePlayers}</strong> active</span>
        <span><strong>{stats.inactivePlayers}</strong> inactive</span>
        <span><strong>{stats.playersWithPicks}</strong> with picks</span>
        <span><strong>{stats.playersWithoutPicks}</strong> no picks</span>
        <span><strong>{stats.predictions}</strong> picks</span>
        <span><strong>{stats.avgPicksPerActive}</strong> avg / active</span>
        <span><strong>{stats.favorites}</strong> favorites</span>
        <span><strong>{stats.publishedMatches}</strong> published</span>
        <span><strong>{stats.openMatches}</strong> open</span>
        <span><strong>{stats.completedMatches}</strong> completed</span>
        <span><strong>{stats.lockedMatches}</strong> locked</span>
      </div>
      <div className="family-stats-detail">
        <p className="muted">Last activity: {stats.lastActivity ? formatDate(stats.lastActivity) : 'No player activity yet'}</p>
        {topSubmitters.length > 0 && (
          <div>
            <strong>Top submitters</strong>
            <div className="submitted-list">
              {topSubmitters.map((row) => (
                <span key={row.player.id}>{getPlayerDisplayName(row.player)} · {row.count} pick{row.count === 1 ? '' : 's'}</span>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function BracketHealthPanel({ matches }) {
  const health = getBracketHealth(matches);
  if (!health.total) return null;
  const issueCount = health.missingSlots + health.duplicateSlots.length + health.missingNextLinks + health.unpublished + health.missingOfficialData;

  return (
    <section className="panel bracket-health-panel">
      <div className="section-heading">
        <div>
          <h2>Knockout bracket health</h2>
          <p className="muted">Checks bracket metadata on knockout matches before the tree goes live.</p>
        </div>
        <span className={issueCount ? 'health-pill warning' : 'health-pill ok'}>
          {issueCount ? `${issueCount} issue${issueCount === 1 ? '' : 's'}` : 'Ready'}
        </span>
      </div>
      <div className="clone-kpis">
        <span><strong>{health.total}</strong> knockout</span>
        <span><strong>{health.missingSlots}</strong> missing slots</span>
        <span><strong>{health.duplicateSlots.length}</strong> duplicate slots</span>
        <span><strong>{health.missingNextLinks}</strong> missing next links</span>
        <span><strong>{health.unpublished}</strong> unpublished</span>
        <span><strong>{health.missingOfficialData}</strong> missing official data</span>
      </div>
      {health.duplicateSlots.length > 0 && (
        <p className="muted">Duplicate slots: {health.duplicateSlots.join(', ')}</p>
      )}
    </section>
  );
}

function AdminLockButton({ match, quickUpdate }) {
  if (isKickoffClosed(match)) {
    return (
      <button disabled title="Predictions are already closed because kickoff time has passed. Edit kickoff time to reopen.">
        Closed after kickoff
      </button>
    );
  }
  if (match.is_locked) {
    return <button onClick={() => quickUpdate(match.id, { is_locked: false })}>Unlock manual lock</button>;
  }
  return <button onClick={() => quickUpdate(match.id, { is_locked: true })}>Lock manually</button>;
}

function AdminPlayersPanel({ tournament, players, predictions, matches, refresh, setMessage, setError }) {
  const activePlayers = useMemo(() => players.filter(isPlayerActive), [players]);
  const [targetId, setTargetId] = useState(activePlayers[0]?.id || '');
  const [sourceId, setSourceId] = useState('');
  const [mergeReason, setMergeReason] = useState('');
  const [preview, setPreview] = useState(null);
  const [conflictResolutions, setConflictResolutions] = useState({});
  const [busy, setBusy] = useState('');
  const [deactivationReasons, setDeactivationReasons] = useState({});
  const predictionCounts = useMemo(() => countBy(predictions, 'player_id'), [predictions]);
  const matchById = useMemo(() => new Map(matches.map((match) => [match.id, match])), [matches]);
  const sortedPlayers = useMemo(
    () => [...players].sort((a, b) => getPlayerDisplayName(a).localeCompare(getPlayerDisplayName(b))),
    [players],
  );

  useEffect(() => {
    if (targetId && activePlayers.some((player) => player.id === targetId)) return;
    setTargetId(activePlayers[0]?.id || '');
  }, [activePlayers, targetId]);

  const resetPreview = () => {
    setPreview(null);
    setConflictResolutions({});
  };

  const loadPreview = async () => {
    setMessage('');
    setError('');
    setBusy('preview');
    try {
      const payload = await runAdminPlayersRequest({
        action: 'preview-merge',
        tournament_id: tournament?.id,
        target_player_id: targetId,
        source_player_id: sourceId,
      });
      setPreview(payload);
      setConflictResolutions(Object.fromEntries((payload.conflicts || []).map((conflict) => [conflict.match_id, 'target'])));
    } catch (err) {
      setError(err.message || 'Could not preview player merge.');
    } finally {
      setBusy('');
    }
  };

  const merge = async () => {
    if (!preview) return;
    if (!confirm(`Merge ${preview.source_player.name} into ${preview.target_player.name}? The source account will be deactivated.`)) return;
    setMessage('');
    setError('');
    setBusy('merge');
    try {
      const conflict_resolutions = (preview.conflicts || []).map((conflict) => ({
        match_id: conflict.match_id,
        keep: conflictResolutions[conflict.match_id] || 'target',
      }));
      const payload = await runAdminPlayersRequest({
        action: 'merge',
        tournament_id: tournament?.id,
        target_player_id: targetId,
        source_player_id: sourceId,
        reason: mergeReason,
        conflict_resolutions,
      });
      setMessage(`Merged player profiles. Moved ${payload.counts?.moved_predictions || 0} picks and resolved ${payload.counts?.conflicts_resolved || 0} conflicts.`);
      setMergeReason('');
      setSourceId('');
      resetPreview();
      await refresh();
    } catch (err) {
      setError(err.message || 'Could not merge player profiles.');
    } finally {
      setBusy('');
    }
  };

  const deactivate = async (player) => {
    const reason = deactivationReasons[player.id] || '';
    if (!reason.trim()) {
      setError('Enter a deactivation reason first.');
      return;
    }
    if (!confirm(`Deactivate ${player.name}? Their picks will remain stored for audit.`)) return;
    setMessage('');
    setError('');
    setBusy(player.id);
    try {
      await runAdminPlayersRequest({
        action: 'deactivate',
        tournament_id: tournament?.id,
        player_id: player.id,
        reason,
      });
      setMessage(`Deactivated ${player.name}.`);
      setDeactivationReasons((current) => ({ ...current, [player.id]: '' }));
      await refresh();
    } catch (err) {
      setError(err.message || 'Could not deactivate player.');
    } finally {
      setBusy('');
    }
  };

  const setPublicStatsVisibility = async (player, hidden) => {
    setMessage('');
    setError('');
    setBusy(`visibility-${player.id}`);
    try {
      await runAdminPlayersRequest({
        action: 'set-public-stats-visibility',
        tournament_id: tournament?.id,
        player_id: player.id,
        hidden,
      });
      setMessage(hidden ? `${player.name} is hidden from public stats and keeps app access.` : `${player.name} is visible in public stats.`);
      await refresh();
    } catch (err) {
      setError(err.message || 'Could not update public stats visibility.');
    } finally {
      setBusy('');
    }
  };

  return (
    <section className="panel admin-players-panel">
      <div className="section-heading">
        <div>
          <h2>Players</h2>
          <p className="muted">Deactivate duplicate profiles or merge picks into one active account.</p>
        </div>
      </div>

      <div className="admin-player-merge">
        <label>
          Keep active account
          <select value={targetId} onChange={(event) => {
            setTargetId(event.target.value);
            resetPreview();
          }}>
            <option value="">Choose player</option>
            {activePlayers.map((player) => (
              <option key={player.id} value={player.id}>{player.name}</option>
            ))}
          </select>
        </label>
        <label>
          Merge and deactivate account
          <select value={sourceId} onChange={(event) => {
            setSourceId(event.target.value);
            resetPreview();
          }}>
            <option value="">Choose player</option>
            {sortedPlayers.filter((player) => player.id !== targetId).map((player) => (
              <option key={player.id} value={player.id}>{getPlayerDisplayName(player)}</option>
            ))}
          </select>
        </label>
        <label>
          Merge reason
          <input value={mergeReason} onChange={(event) => setMergeReason(event.target.value)} placeholder="Duplicate profile, name upgrade, or admin note" />
        </label>
        <button onClick={loadPreview} disabled={busy === 'preview' || !targetId || !sourceId}>
          {busy === 'preview' ? 'Previewing...' : 'Preview merge'}
        </button>
      </div>

      {preview && (
        <div className="merge-preview">
          <div className="merge-summary">
            <span><strong>{preview.counts?.source_predictions || 0}</strong> source picks</span>
            <span><strong>{preview.counts?.transferable_predictions || 0}</strong> movable</span>
            <span><strong>{preview.counts?.conflicts || 0}</strong> conflicts</span>
            <span><strong>{preview.counts?.source_favorites || 0}</strong> source favorites</span>
          </div>
          {(preview.conflicts || []).length > 0 && (
            <div className="merge-conflicts">
              <strong>Resolve duplicate match picks</strong>
              {preview.conflicts.map((conflict) => (
                <article key={conflict.match_id} className="merge-conflict-row">
                  <div>
                    <strong>{formatConflictMatch(conflict.match, matchById.get(conflict.match_id))}</strong>
                    <p className="muted">Target: {formatPredictionScore(conflict.target_prediction)} · Source: {formatPredictionScore(conflict.source_prediction)}</p>
                  </div>
                  <select
                    value={conflictResolutions[conflict.match_id] || 'target'}
                    onChange={(event) => setConflictResolutions((current) => ({
                      ...current,
                      [conflict.match_id]: event.target.value,
                    }))}
                  >
                    <option value="target">Keep target pick</option>
                    <option value="source">Use source pick</option>
                  </select>
                </article>
              ))}
            </div>
          )}
          <button className="primary" onClick={merge} disabled={busy === 'merge' || !mergeReason.trim()}>
            {busy === 'merge' ? 'Merging...' : 'Merge profiles'}
          </button>
        </div>
      )}

      <div className="admin-player-list">
        {sortedPlayers.map((player) => (
          <article className={`admin-player-row ${isPlayerActive(player) ? '' : 'inactive'}`} key={player.id}>
            <div>
              <strong>{getPlayerDisplayName(player)}</strong>
              <p>{predictionCounts.get(player.id) || 0} picks · created {formatDate(player.created_at)}</p>
              {isPlayerActive(player) && player.hidden_from_public_stats && <p>Hidden from public stats, app access kept.</p>}
              {!isPlayerActive(player) && <p>{player.deactivation_reason || 'Inactive player'}</p>}
            </div>
            {isPlayerActive(player) ? (
              <div className="admin-player-actions">
                <input
                  value={deactivationReasons[player.id] || ''}
                  onChange={(event) => setDeactivationReasons((current) => ({ ...current, [player.id]: event.target.value }))}
                  placeholder="Deactivation reason"
                />
                <button className="danger" onClick={() => deactivate(player)} disabled={busy === player.id}>
                  {busy === player.id ? 'Deactivating...' : 'Deactivate'}
                </button>
                {player.hidden_from_public_stats ? (
                  <button onClick={() => setPublicStatsVisibility(player, false)} disabled={busy === `visibility-${player.id}`}>
                    {busy === `visibility-${player.id}` ? 'Updating...' : 'Show in public stats'}
                  </button>
                ) : (
                  <button onClick={() => setPublicStatsVisibility(player, true)} disabled={busy === `visibility-${player.id}`}>
                    {busy === `visibility-${player.id}` ? 'Updating...' : 'Hide from public stats'}
                  </button>
                )}
              </div>
            ) : (
              <span className="inactive-pill">Inactive</span>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

function getFamilyKpis({ players = [], matches = [], predictions = [], favorites = [] }) {
  const activePlayers = players.filter(isPlayerActive);
  const publicPlayers = players.filter(isPublicStatsPlayer);
  const publicPlayerIds = new Set(publicPlayers.map((player) => player.id));
  const publicPredictions = predictions.filter((prediction) => publicPlayerIds.has(prediction.player_id));
  const predictionCounts = countBy(publicPredictions, 'player_id');
  const playersWithPicks = publicPlayers.filter((player) => (predictionCounts.get(player.id) || 0) > 0);
  const topSubmitters = [...publicPlayers]
    .map((player) => ({ player, count: predictionCounts.get(player.id) || 0 }))
    .filter((row) => row.count > 0)
    .sort((a, b) => b.count - a.count || getPlayerDisplayName(a.player).localeCompare(getPlayerDisplayName(b.player)));

  return {
    players: players.length,
    activePlayers: activePlayers.length,
    inactivePlayers: players.length - activePlayers.length,
    playersWithPicks: playersWithPicks.length,
    playersWithoutPicks: Math.max(publicPlayers.length - playersWithPicks.length, 0),
    predictions: publicPredictions.length,
    avgPicksPerActive: publicPlayers.length ? (publicPredictions.length / publicPlayers.length).toFixed(1) : '0.0',
    favorites: favorites.length,
    publishedMatches: matches.filter((match) => match.is_published).length,
    openMatches: matches.filter((match) => match.is_published && !isMatchLocked(match)).length,
    completedMatches: matches.filter(isFinalScoreComplete).length,
    lockedMatches: matches.filter(isMatchLocked).length,
    topSubmitters,
    lastActivity: latestTimestamp([
      ...players.map((player) => player.created_at),
      ...publicPredictions.map((prediction) => prediction.updated_at || prediction.submitted_at),
      ...favorites.map((favorite) => favorite.created_at),
    ]),
  };
}

function Top10CodesPanel({ tournament, setMessage, setError }) {
  const [codes, setCodes] = useState([]);
  const [busy, setBusy] = useState('');
  const [setupWarning, setSetupWarning] = useState('');

  const loadCodes = async () => {
    if (!tournament?.id) return;
    setBusy('load');
    setMessage('');
    setError('');
    setSetupWarning('');
    try {
      const payload = await runTop10Request({
        action: 'admin-list',
        tournament_id: tournament.id,
      }, true);
      setCodes(payload.codes || []);
      if (payload.setupRequired) setSetupWarning(payload.warning || getTop10SetupMessage());
    } catch (err) {
      setError(err.message || 'Could not load Top 10 codes.');
    } finally {
      setBusy('');
    }
  };

  const syncCodes = async () => {
    if (!tournament?.id) return;
    setBusy('sync');
    setMessage('');
    setError('');
    setSetupWarning('');
    try {
      const payload = await runTop10Request({
        action: 'sync',
        tournament_id: tournament.id,
      });
      if (payload.setupRequired) {
        setSetupWarning(payload.warning || getTop10SetupMessage());
        setCodes([]);
        return;
      }
      setMessage(`Top 10 status synced. New protected players: ${payload.created || 0}.`);
      await loadCodes();
    } catch (err) {
      setError(err.message || 'Could not sync Top 10 status.');
    } finally {
      setBusy('');
    }
  };

  const resetCode = async (codeRow) => {
    setBusy(codeRow.id);
    setMessage('');
    setError('');
    setSetupWarning('');
    try {
      const payload = await runTop10Request({
        action: 'admin-reset',
        tournament_id: tournament.id,
        code_id: codeRow.id,
      }, true);
      setMessage(`Reset code for ${getProtectedPlayerName(payload.code)}.`);
      await loadCodes();
    } catch (err) {
      setError(err.message || 'Could not reset Top 10 code.');
    } finally {
      setBusy('');
    }
  };

  return (
    <section className="panel top10-panel">
      <div className="section-heading">
        <div>
          <h2>Top 10 protection</h2>
          <p className="muted">Protect players who have ever entered the Top 10 after a finished match.</p>
        </div>
        <div className="button-row">
          <button onClick={syncCodes} disabled={Boolean(busy)}>{busy === 'sync' ? 'Syncing...' : 'Sync Top 10'}</button>
          <button onClick={loadCodes} disabled={Boolean(busy)}>{busy === 'load' ? 'Loading...' : 'Load codes'}</button>
        </div>
      </div>
      {setupWarning && <p className="entry-error">{setupWarning}</p>}
      {codes.length > 0 && (
        <div className="top10-code-grid">
          {codes.map((codeRow) => (
            <article className="top10-code-card" key={codeRow.id}>
              <strong>{getProtectedPlayerName(codeRow)}</strong>
              <span>{codeRow.status_label || 'Top 10'} · rank {codeRow.awarded_rank || '-'}</span>
              <code>{codeRow.code}</code>
              <button onClick={() => resetCode(codeRow)} disabled={busy === codeRow.id}>
                {busy === codeRow.id ? 'Resetting...' : 'Reset code'}
              </button>
            </article>
          ))}
        </div>
      )}
      {!codes.length && <p className="muted">Load codes after the first finished match to see protected players.</p>}
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

function HelpPage({ navigate, routeBase }) {
  const goTo = (pageRoute) => navigate(buildRoute(routeBase, pageRoute));
  return (
    <section className="help-page">
      <PageTitle title="How to play" />

      <div className="panel help-intro">
        <p className="eyebrow">Quick guide</p>
        <h2>Make your picks, follow the match, and enjoy the group leaderboard.</h2>
        <p className="muted">
          This page explains the basics in plain language. Your group may be the main app or a private corporate group, but the steps are the same.
        </p>
        <div className="help-actions">
          <button className="primary" onClick={() => goTo('/matches')}>Go to matches</button>
          <button onClick={() => goTo('/predictions')}>Check picks</button>
          <button onClick={() => goTo('/leaderboard')}>View leaderboard</button>
        </div>
      </div>

      <div className="help-grid">
        <article className="panel help-card">
          <span className="help-step">1</span>
          <h2>Enter your name</h2>
          <p>Start on the welcome page and use your first and last name, so the leaderboard stays clear.</p>
        </article>
        <article className="panel help-card">
          <span className="help-step">2</span>
          <h2>Predict scores</h2>
          <p>Open Matches, type the final score you expect, and submit before the match closes.</p>
        </article>
        <article className="panel help-card">
          <span className="help-step">3</span>
          <h2>Follow results</h2>
          <p>After matches are played, check recaps, Picks, and the highlighted Leaderboard to see how everyone did.</p>
        </article>
      </div>

      <section className="panel help-section">
        <h2>What each page is for</h2>
        <div className="help-link-list">
          <button onClick={() => goTo('/matches')}>Matches</button>
          <p>Submit predictions, see live scores, open Match Insight, and review played-match recaps with stats, goals, and grouped key events.</p>
          <button onClick={() => goTo('/predictions')}>Picks</button>
          <p>Check your own predictions and see everyone else after picks are revealed.</p>
          <button onClick={() => goTo('/stats')}>My Stats</button>
          <p>See your points, rank, accuracy, nearby leaderboard, open pick gaps, and protected Top 10 code when available.</p>
          <button onClick={() => goTo('/groups')}>Groups</button>
          <p>See group tables and schedules. Tap a country flag or name to open its nation page.</p>
          <button onClick={() => goTo('/favorites')}>Favorites</button>
          <p>Keep your favorite teams in one place. Add or remove them with the star beside a team.</p>
          <button onClick={() => goTo('/leaderboard')}>Leaderboard</button>
          <p>Track points after matches finish. Rank #1 is marked as Leader, ranks #2-#10 are highlighted as Top 10, and your name appears once you submit a prediction.</p>
        </div>
      </section>

      <section className="help-faq" aria-label="Frequently asked questions">
        {[
          {
            question: 'Why can I not see other people predictions?',
            answer:
              'Predictions stay hidden before kickoff or before the admin reveals them. This keeps the game fair, so nobody can copy another player pick.',
          },
          {
            question: 'Can I change my prediction?',
            answer:
              'Yes, while the match is still open. Once kickoff time passes or the admin locks the match, predictions close and the score cannot be changed.',
          },
          {
            question: 'What does Closed after kickoff mean?',
            answer:
              'It means the match start time has passed. The app closes predictions automatically at kickoff, even if the match was not manually locked by the admin.',
          },
          {
            question: 'How are points calculated?',
            answer:
              'An exact score gives 3 points. A correct match outcome gives 1 point. For example, predicting the winner correctly but not the exact score earns 1 point.',
          },
          {
            question: 'Why is my name missing from the leaderboard?',
            answer:
              'The leaderboard only shows players who submitted at least one prediction. Submit your first pick and your name will appear.',
          },
          {
            question: 'Why do I need first and last name?',
            answer:
              'Use your first and last name so players do not have the same name on the leaderboard. If you already used one name, the app will show your existing profile first, then ask you to confirm the full-name update before anything changes. Your saved picks stay with the same profile.',
          },
          {
            question: 'What is Top 10 protection?',
            answer:
              'When you enter the current Top 10 with more than zero points, you get a celebration message, a private code, and a status badge. Rank #1 appears as Leader, while ranks #2 to #10 appear as Top 10. Copy or save your code. It protects your profile, picks, leaderboard history, and earned status if you use a new browser or device.',
          },
          {
            question: 'Why did my Top 10 badge disappear?',
            answer:
              'The Leader or Top 10 badge appears only while you are currently ranked 1 to 10. If you drop out of the current Top 10, your protected profile details remain available in My Stats.',
          },
          {
            question: 'What is Match Insight?',
            answer:
              'Match Insight gives quick helper information before the match, including prediction aids and match-winner odds when available. The header shows the item count, the latest update time, and the favored team when the odds have enough data.',
          },
          {
            question: 'What is Match Recap?',
            answer:
              'Match Recap appears for played matches and shows formations, comparison stats, grouped key events, goals, market view, and odds. Key events are grouped by priority so red cards, yellow cards, VAR reviews, and substitutions are easier to scan.',
          },
          {
            question: 'Why do some event boxes disappear or group together?',
            answer:
              'The football provider can send duplicate event rows. The app cleans up common duplicates for display, such as repeated cards, goals, and substitutions, while keeping the raw provider data in the database.',
          },
          {
            question: 'What happens in a private corporate group?',
            answer:
              'A private corporate group has its own players, predictions, favorites, and leaderboard. The match schedule, live data, insights, odds, and recaps are copied from the source app so the group does not need separate provider calls.',
          },
          {
            question: 'Can I use the same name in different corporate groups?',
            answer:
              'Yes. Each corporate group is separate, so your picks and leaderboard position stay inside that group. For BCI26, use your first and last name so the leaderboard stays clear.',
          },
        ].map((item) => (
          <details className="help-item" key={item.question}>
            <summary>{item.question}</summary>
            <p>{item.answer}</p>
          </details>
        ))}
      </section>
    </section>
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
  return ['/', '/matches', '/predictions', '/stats', '/groups', '/bracket', '/favorites', '/leaderboard', '/top10-code', '/admin', '/help'].includes(path) ? path : '/';
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

function readStoredTop10Protection() {
  try {
    return JSON.parse(localStorage.getItem('top10-protection') || 'null');
  } catch {
    return null;
  }
}

function writeStoredTop10Protection(value) {
  if (value?.protected && value?.code && value?.playerId) {
    localStorage.setItem('top10-protection', JSON.stringify(value));
  } else {
    localStorage.removeItem('top10-protection');
  }
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

function getKsaDayKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'unknown';
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: KSA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const partMap = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${partMap.year}-${partMap.month}-${partMap.day}`;
}

function formatKsaDayLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date TBD';
  return new Intl.DateTimeFormat(undefined, {
    timeZone: KSA_TIME_ZONE,
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

function groupMatchesByKsaDay(matches = []) {
  const groups = [];
  const groupsByKey = new Map();
  matches.forEach((match) => {
    const key = getKsaDayKey(match.kickoff_time);
    let group = groupsByKey.get(key);
    if (!group) {
      group = {
        key,
        label: formatKsaDayLabel(match.kickoff_time),
        matches: [],
      };
      groupsByKey.set(key, group);
      groups.push(group);
    }
    group.matches.push(match);
  });
  return groups;
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

function countBy(rows = [], field) {
  const counts = new Map();
  rows.forEach((row) => counts.set(row[field], (counts.get(row[field]) || 0) + 1));
  return counts;
}

function getLiveScore(match) {
  const scoreA = match.live_team_a_score ?? (match.status === 'live' ? match.team_a_score : null);
  const scoreB = match.live_team_b_score ?? (match.status === 'live' ? match.team_b_score : null);
  if (scoreA === null || scoreA === undefined || scoreB === null || scoreB === undefined) return '';
  return `${scoreA} - ${scoreB}`;
}

function isBracketSourceLabel(value) {
  return /^(tbd|winner |runner-up |best 3rd |loser )/i.test(String(value || '').trim());
}

function formatPredictionScore(prediction) {
  if (!prediction) return '-';
  return `${prediction.predicted_team_a_score}-${prediction.predicted_team_b_score}`;
}

function formatConflictMatch(previewMatch, localMatch) {
  const match = previewMatch || localMatch;
  if (!match) return 'Unknown match';
  return `${match.team_a} vs ${match.team_b}`;
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

async function runTop10Request(body, admin = false) {
  const headers = { 'Content-Type': 'application/json' };
  if (admin) headers['x-admin-password'] = sessionStorage.getItem('admin-password') || ADMIN_PASSWORD;
  const response = await fetch('/api/top10-status', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Top 10 request failed.');
  return payload;
}

async function runAdminPlayersRequest(body) {
  const response = await fetch('/api/admin-players', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-password': sessionStorage.getItem('admin-password') || ADMIN_PASSWORD,
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Player admin request failed.');
  return payload;
}

async function savePrediction({ player, match, tournament, scoreA, scoreB }) {
  const now = new Date().toISOString();
  const payload = {
    player_id: player.id,
    match_id: match.id,
    ...((match.tournament_id || tournament?.id) ? { tournament_id: match.tournament_id || tournament.id } : {}),
    predicted_team_a_score: scoreA,
    predicted_team_b_score: scoreB,
    updated_at: now,
  };

  const existingResponse = await supabase
    .from('predictions')
    .select('id,submitted_at')
    .eq('player_id', player.id)
    .eq('match_id', match.id)
    .order('submitted_at', { ascending: true })
    .limit(1);
  throwIfError(existingResponse.error);

  const existing = existingResponse.data?.[0] || null;
  if (existing?.id) {
    const { data, error } = await supabase
      .from('predictions')
      .update(payload)
      .eq('id', existing.id)
      .select('id,submitted_at')
      .single();
    throwIfError(error);
    return data || existing;
  }

  const { data, error } = await supabase
    .from('predictions')
    .insert({ ...payload, submitted_at: now })
    .select('id,submitted_at')
    .single();
  throwIfError(error);
  return data;
}

function createTop10Celebration({ player, code, status, firstReveal = false }) {
  return {
    playerName: player?.name || status?.name || 'Player',
    code: code || '',
    rank: status?.rank || null,
    statusLabel: status?.status_label || 'Top 10',
    firstReveal,
  };
}

function getProtectedPlayerName(codeRow) {
  const player = Array.isArray(codeRow?.players) ? codeRow.players[0] : codeRow?.players;
  return player?.name || codeRow?.name || 'Protected player';
}

function getTop10SetupMessage() {
  return 'Top 10 protection is not set up for this app database yet. Run the top10_player_codes Supabase migration for this project, then click Sync Top 10 again.';
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

async function selectRowsForMatches(supabaseClient, table, matchIds = [], orderField = '') {
  if (!matchIds.length) return { data: [], error: null };
  let query = supabaseClient.from(table).select('*').in('match_id', matchIds);
  if (orderField) query = query.order(orderField);
  return optionalSelect(query);
}

function isMissingOptionalRelation(error) {
  if (!error) return false;
  return error.code === 'PGRST205' ||
    error.code === '42P01' ||
    /could not find the table|schema cache|does not exist/i.test(error.message || '');
}

function getPlayerDisplayName(player) {
  if (!player) return 'Unknown player';
  return isPlayerActive(player) ? player.name : `${player.name} (inactive)`;
}

function isUniqueViolation(error) {
  return error?.code === '23505' || /duplicate key|unique/i.test(error?.message || '');
}

createRoot(document.getElementById('root')).render(<App />);
