import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { supabase, isSupabaseConfigured } from './lib/supabase.js';
import { calculateLeaderboard, isFinalScoreComplete } from './lib/scoring.js';
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
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const refresh = async () => {
    if (!isSupabaseConfigured) return;
    setLoading(true);
    setError('');
    try {
      const [playerRows, matchRows, predictionRows] = await Promise.all([
        supabase.from('players').select('*').order('created_at'),
        supabase.from('matches').select('*').order('kickoff_time'),
        supabase.from('predictions').select('*').order('submitted_at'),
      ]);
      throwIfError(playerRows.error);
      throwIfError(matchRows.error);
      throwIfError(predictionRows.error);
      setPlayers(playerRows.data || []);
      setMatches(matchRows.data || []);
      setPredictions(predictionRows.data || []);
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

  const pageProps = {
    player,
    setPlayer,
    players,
    matches,
    predictions,
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
          World Cup Picks
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

function HomePage({ player, setPlayer, players, refresh, setMessage, setError, navigate }) {
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
        .insert({ name: cleanName, player_token: token, is_active: true })
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
        <h1>Predict FIFA World Cup 2026 scores.</h1>
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

function MatchesPage({ player, players, matches, predictions, refresh, loading, setMessage, setError, navigate }) {
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
        .filter((match) => !isMatchPlayed(match))
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

function PredictionCard({ match, prediction, submittedPredictions, playersById, player, refresh, setMessage, setError }) {
  const [teamAScore, setTeamAScore] = useState(prediction?.predicted_team_a_score ?? '');
  const [teamBScore, setTeamBScore] = useState(prediction?.predicted_team_b_score ?? '');
  const locked = isMatchLocked(match);
  const lockReason = getMatchLockReason(match);
  const hasResult = isFinalScoreComplete(match);

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
    <article className="match-card">
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
      {match.venue && <p className="muted">{match.venue}</p>}
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

function LeaderboardPage({ players, matches, predictions, refresh }) {
  const rows = calculateLeaderboard(players, matches, predictions);
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

function AdminTools({ matches, refresh, setMessage, setError }) {
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
      const fixtures = normalizeFixtureRows(rows);
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
              </p>
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

function isMatchLocked(match) {
  return Boolean(match.is_locked) || new Date(match.kickoff_time).getTime() <= Date.now();
}

function isMatchPlayed(match) {
  return match.status === 'finished' || isFinalScoreComplete(match) || new Date(match.kickoff_time).getTime() <= Date.now();
}

function getMatchLockReason(match) {
  if (match.is_locked) return 'Predictions are closed because the admin lock is on.';
  if (new Date(match.kickoff_time).getTime() <= Date.now()) {
    return 'Predictions are closed because kickoff time has passed. Edit the kickoff time to reopen it.';
  }
  return '';
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

function toLocalInputValue(value) {
  if (!value) return '';
  const date = new Date(value);
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return offsetDate.toISOString().slice(0, 16);
}

function throwIfError(error) {
  if (error) throw error;
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
