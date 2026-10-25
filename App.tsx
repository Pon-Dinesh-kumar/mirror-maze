import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, BackHandler, StatusBar, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import { MapScroll, World, WorldMode } from './src/world/World';
import { BEAM_SPEED } from './src/world/Beam';
import { CHARGE_TIME } from './src/world/Crystal';
import { LAND, TURN_IMPACT } from './src/world/Totems';
import { ABYSS_SECONDS } from './src/world/abyss';
import { Curtain } from './src/ui/Effects';
import { PerfOverlay } from './src/ui/PerfOverlay';
import { PERF_HUD } from './src/world/perf';
import { GameText } from './src/ui/GameText';
import { ChapterUI, Panel, ToyButton } from './src/ui/Toy';
import { Splash } from './src/screens/Splash';
import { Prologue } from './src/screens/Prologue';
import { Home, HomeExtra } from './src/screens/Home';
import { JourneyMap, StoryKind } from './src/screens/Map';
import { ChapterIntro } from './src/screens/ChapterIntro';
import { Gameplay, HUD_BOTTOM, HUD_TOP } from './src/screens/Gameplay';
import { Complete, Fail } from './src/screens/Complete';
import { Ending, Forge, Outro } from './src/screens/Story';
import { PauseModal, SettingsModal } from './src/screens/Modals';
import { useSave } from './src/services/useSave';
import { audio } from './src/services/audio';
import { ads } from './src/services/ads';
import { adPrivacy, startAds } from './src/services/adMob';
import { useRemoveAds } from './src/services/removeAds';
import { usePlayGames } from './src/services/usePlayGames';
import { AdFree, purchaseNotice } from './src/ui/AdFree';
import { voice } from './src/services/voice';
import { heartsEarned, recordResult, SHARDS_PER_WORLD, totalShards, unlockedLevel, worldShards } from './src/game/progress';
import { levels } from './src/game/levels';
import { chapterOf, firstLevelOf, LEVELS_PER_CHAPTER } from './src/game/chapters';
import { applyMove, canRotate, clusterOfTotem, initialState, solve, solveSliced, starsFor, traceState } from './src/game/engine';
import type { HudStatus } from './src/screens/Gameplay';
import { isOpen } from './src/game/testing';
import { PlayState, Trace } from './src/game/types';

type Screen = 'splash' | 'prologue' | 'home' | 'map' | 'intro' | 'game' | 'complete' | 'fail' | 'outro' | 'forge' | 'ending';
const worldMode: Record<Screen, WorldMode> = {
  splash: 'splash', prologue: 'prologue', home: 'menu', map: 'map', intro: 'intro', game: 'game',
  complete: 'complete', fail: 'fail', outro: 'outro', forge: 'forge', ending: 'ending',
};
const cinematic: Screen[] = ['splash', 'prologue', 'intro'];
interface Win { moves: number; stars: number; before: number; after: number }
interface Snapshot { play: PlayState; moves: number }

function GameApp() {
  const [fontsLoaded, fontError] = useFonts({
    Lilita: require('@expo-google-fonts/lilita-one/400Regular/LilitaOne_400Regular.ttf'),
    FredokaBold: require('@expo-google-fonts/fredoka/700Bold/Fredoka_700Bold.ttf'),
    FredokaSemi: require('@expo-google-fonts/fredoka/600SemiBold/Fredoka_600SemiBold.ttf'),
    Cinzel: require('@expo-google-fonts/cinzel/900Black/Cinzel_900Black.ttf'),
    CinzelBold: require('@expo-google-fonts/cinzel/700Bold/Cinzel_700Bold.ttf'),
  });
  const safe = useSafeAreaInsets();
  const save = useSave();
  const removeAds = useRemoveAds();
  const [screen, setScreen] = useState<Screen>('splash');
  const [modal, setModal] = useState<'settings' | 'pause'>();
  const [active, setActive] = useState(AppState.currentState === 'active');
  const [privacyForm, setPrivacyForm] = useState(false);
  const [levelId, setLevelId] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [play, setPlay] = useState<PlayState>(() => initialState(levels[0]!));
  const [moves, setMoves] = useState(0);
  const [history, setHistory] = useState<Snapshot[]>([]);
  const [hint, setHint] = useState<string>();
  const [win, setWin] = useState<Win>();
  const [celebrate, setCelebrate] = useState(false);
  const [mapChapter, setMapChapter] = useState(0);
  const [mapFocus, setMapFocus] = useState(1);
  const [forging, setForging] = useState<number>();
  const [notice, setNotice] = useState<string>();
  const playGames = usePlayGames(save, useCallback(() => setNotice('Your journey was restored from your Google Play Games cloud save.'), []));
  const [curtain, setCurtain] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [view, setView] = useState<'tilt' | 'top'>('tilt');
  /** The piece the player is holding to preview its light, and why the last attempt was lost. */
  const [previewId, setPreviewId] = useState<string>();
  const [failReason, setFailReason] = useState<'moves' | 'devoured'>('moves');
  /** A cutscene being re-watched from the journey map; when it ends the player returns to the map. */
  const [replay, setReplay] = useState<{ kind: StoryKind; chapter: number }>();
  /** boardKey of the last board the 3D world has finished drawing; the level stays covered until it matches. */
  const [readyBoard, setReadyBoard] = useState<string>();
  /**
   * While a totem's stones turn: the light shown until they land (the rules have already moved on). `landing` holds what
   * the move decides (a win, a loss, nothing yet), played out once they land.
   */
  const [turning, setTurning] = useState<Trace>();
  const landing = useRef<{ token: object; settle: () => void } | undefined>(undefined);
  /**
   * A loss to the Devourer: the one guarded failure in flight (its token), and whether its absorption sequence has
   * finished, so the defeat screen may appear (it waits for the pause menu to close).
   */
  const devour = useRef<object | undefined>(undefined);
  const [devourOver, setDevourOver] = useState(false);
  const mapScroll = useMemo<MapScroll>(() => ({ progress: 0, y: 0 }), []);
  const traceCache = useRef<{ level: typeof levels[number]; state: PlayState; trace: Trace } | null>(null);
  const lock = useRef(0);
  const curtainTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  /** The hint search in flight and the board it is solving. */
  const hintJob = useRef<{ play: PlayState; cancel: () => void } | undefined>(undefined);
  const progress = save.data.progress;
  const seen = save.data.seen;
  const next = unlockedLevel(progress, levels.length + 1);
  const total = totalShards(progress);
  const hearts = useMemo(() => heartsEarned(progress), [progress]);
  const level = levels[levelId - 1]!;
  const playing = ['game', 'complete', 'fail', 'outro', 'intro'].includes(screen) && !replay;
  const homeChapter = chapterOf(Math.min(next, levels.length));
  const worldChapter = replay ? replay.chapter : playing ? level.chapter : screen === 'map' ? mapChapter : screen === 'forge' && forging !== undefined ? forging : homeChapter;
  const insets = useMemo(() => ({ top: safe.top + HUD_TOP, bottom: safe.bottom + HUD_BOTTOM }), [safe.top, safe.bottom]);

  const boardLevel = useMemo(() => {
    if (playing) return level;
    const first = firstLevelOf(worldChapter);
    return levels[Math.min(Math.max(next, first), first + LEVELS_PER_CHAPTER - 1) - 1]!;
  }, [playing, level, worldChapter, next]);
  const boardState = useMemo(() => (playing ? play : initialState(boardLevel)), [playing, play, boardLevel]);
  const trace = useMemo(() => {
    const cached = traceCache.current;
    if (cached?.level === boardLevel && cached.state === boardState) return cached.trace;
    const next = traceState(boardLevel, boardState);
    traceCache.current = { level: boardLevel, state: boardState, trace: next };
    return next;
  }, [boardLevel, boardState]);
  const won = playing && trace.won;
  /** The light on screen: while a totem's stones turn, still the light from before the tap. */
  const shownTrace = turning ?? trace;
  // Holding a piece shows where its light would go after that tap; nothing changes until the player taps.
  const ghost = useMemo(() => {
    if (screen !== 'game' || !previewId || won || !canRotate(level, play, previewId)) return undefined;
    return traceState(level, applyMove(level, play, previewId));
  }, [screen, previewId, won, level, play]);
  /** The chapter modifiers in words, above the board: what a held piece's tap would do, and the seals woken so far. */
  const status = useMemo<HudStatus[]>(() => {
    if (screen !== 'game' || won || play.absorbed) return [];
    const out: HudStatus[] = [];
    if (ghost?.absorbed) out.push({ icon: 'warning', text: 'THIS MOVE FEEDS THE DEVOURER', tone: 'danger' });
    else if (ghost?.won) out.push({ icon: 'sparkles', text: 'THIS MOVE LIGHTS EVERY CRYSTAL', tone: 'gold' });
    const held = previewId ? clusterOfTotem(level, previewId) : undefined;
    if (held) {
      out.push(canRotate(level, play, held.totem.id) ? { icon: 'sync', tone: 'calm', text: `THESE STONES TURN ${held.turn > 0 ? 'CLOCKWISE' : 'COUNTER-CLOCKWISE'}` }
        : { icon: 'hand-left', tone: 'warm', text: 'SOMETHING BLOCKS THESE STONES' });
    }
    if (level.seals.length) out.push({ icon: 'sunny', tone: 'gold', text: `SOLAR SEALS ${level.seals.filter(x => play.sealed[x.id]).length}/${level.seals.length}` });
    return out.slice(0, 2);
  }, [screen, won, play, ghost, level, previewId]);

  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  const cancelHint = () => { hintJob.current?.cancel(); hintJob.current = undefined; };
  const later = (ms: number, fn: () => void) => { timers.current.push(setTimeout(fn, ms)); };
  const go = useCallback((s: Screen) => { setModal(undefined); setScreen(s); }, []);

  useEffect(() => { audio.init(); audio.onFailure(setNotice); return () => audio.dispose(); }, []);
  useEffect(() => { ads.setPauseHooks({ pause: () => setActive(false), resume: () => setActive(AppState.currentState === 'active') }); return () => ads.setPauseHooks(undefined); }, []);
  // Ads start only once Remove Ads is known not to be owned; if they could not start (offline), the next return retries.
  useEffect(() => { if (active && removeAds.loaded && !removeAds.adFree) startAds(); }, [active, removeAds.loaded, removeAds.adFree]);
  useEffect(() => { if (modal === 'settings') void adPrivacy.required().then(setPrivacyForm); }, [modal]);
  useEffect(() => { audio.configure(save.data.settings, active && save.loaded); }, [save.data.settings, active, save.loaded]);
  useEffect(() => { voice.configure(save.data.settings.voice && active); }, [save.data.settings.voice, active]);
  // Narration belongs to cutscenes only; leaving one silences the narrator.
  useEffect(() => { if (!['prologue', 'intro', 'outro', 'forge', 'ending'].includes(screen)) voice.stop(); }, [screen]);
  useEffect(() => { audio.setChapter(screen === 'prologue' || screen === 'ending' ? 4 : worldChapter, screen === 'map'); }, [worldChapter, screen]);
  // Outside the map, switching worlds dips briefly to black; the map hides the swap behind its chapter veils instead.
  const lastWorld = useRef(worldChapter);
  useEffect(() => {
    if (lastWorld.current === worldChapter) return;
    lastWorld.current = worldChapter;
    if (screen === 'map') return;
    if (curtainTimer.current) clearTimeout(curtainTimer.current);
    setCurtain(true);
    curtainTimer.current = setTimeout(() => {
      curtainTimer.current = undefined;
      setCurtain(false);
    }, 360);
  }, [worldChapter, screen]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', s => {
      setActive(s === 'active');
      if (s !== 'active' && screen === 'game') setModal('pause');
      // A long sequence sound would resume out of step with the scene; the scene finishes on its own when the app returns.
      if (s !== 'active') audio.stop('abyss');
    });
    return () => sub.remove();
  }, [screen]);
  // The absorption has finished: the defeat screen fades in, unless the pause menu is open (it then waits for Resume).
  useEffect(() => {
    if (!devourOver || modal || screen !== 'game') return;
    setDevourOver(false);
    setFailReason('devoured');
    go('fail');
    audio.setHush(1, 1600);
  }, [devourOver, modal, screen, go]);
  // Leaving the level mid-absorption cuts its sound and brings the world's music and ambience back.
  useEffect(() => {
    if (screen === 'game' || screen === 'fail') return;
    devour.current = undefined;
    audio.stop('abyss'); audio.stop('swallow'); audio.setHush(1);
  }, [screen]);
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (modal) { setModal(undefined); return true; }
      if (screen === 'game') { setModal('pause'); return true; }
      if (screen !== 'home' && screen !== 'splash') { go('home'); return true; }
      return false;
    });
    return () => sub.remove();
  }, [screen, modal, go]);
  useEffect(() => () => clearTimers(), []);
  useEffect(() => { if (screen !== 'game') cancelHint(); }, [screen]);
  useEffect(() => () => cancelHint(), []);
  useEffect(() => () => {
    if (curtainTimer.current) clearTimeout(curtainTimer.current);
  }, []);

  const begin = (id: number) => {
    clearTimers(); cancelHint();
    const l = levels[id - 1]!;
    landing.current = undefined; setTurning(undefined);
    cancelDevour();
    setLevelId(id); setPlay(initialState(l)); setMoves(0); setHistory([]); setCelebrate(false); setPreviewId(undefined); setFailReason('moves');
    setHint(id <= 2 ? solve(l, initialState(l))?.[0] : undefined);
    setWin(undefined); setAttempt(a => a + 1); lock.current = 0;
  };
  const start = (id: number, allowIntro = true) => {
    if (id < 1 || id > levels.length || !isOpen(id, next)) { audio.play('bonk'); return; }
    const l = levels[id - 1]!;
    begin(id);
    if (allowIntro && l.index === 1 && !seen.intros.includes(l.chapter)) go('intro');
    else go('game');
  };
  const openMap = (focus = Math.min(next, levels.length)) => { setMapFocus(focus); setMapChapter(chapterOf(focus)); go('map'); };
  const finishLevel = (state: PlayState, used: number, result: Trace) => {
    if (!result.won) { console.error('Rejected unverified completion', levelId); return; }
    const stars = starsFor(level, used);
    const before = worldShards(progress, level.chapter);
    const after = worldShards(recordResult(progress, levelId, stars, used), level.chapter);
    save.complete(levelId, stars, used);
    setWin({ moves: used, stars, before, after });
    go('complete');
  };
  const rotate = (id: string) => {
    if (screen !== 'game' || modal || win || Date.now() < lock.current) return;
    if (!canRotate(level, play, id)) { audio.play('bonk'); audio.haptic('error'); return; }
    if (moves >= level.maxMoves) return;
    lock.current = Date.now() + 160;
    cancelHint();
    setPreviewId(undefined);
    const nextState = applyMove(level, play, id);
    const used = moves + 1;
    setHistory(h => [...h, { play, moves }]);
    const t = traceState(level, nextState);
    traceCache.current = { level, state: nextState, trace: t };
    setPlay(nextState); setMoves(used);
    setHint(undefined);
    if (clusterOfTotem(level, id)) {
      // A totem's stones take their time (the 3D world plays the turn and its sounds): the light on screen stays as it
      // was until they land, and only then does the move play out. Nothing else can be touched meanwhile.
      lock.current = Number.MAX_SAFE_INTEGER;
      setTurning(trace);
      audio.haptic();
      const token = {};
      landing.current = { token, settle: () => outcome(nextState, used, t) };
      // If the board cannot report the landing (the app was sent away mid-turn), the move still completes.
      later((TURN_IMPACT + 1.5) * 1000, () => land(token));
      return;
    }
    // Floes play their own glide as they move.
    if (!id.startsWith('f')) audio.play(id.startsWith('e') ? 'turn' : 'rotate');
    audio.play('zap'); audio.haptic();
    outcome(nextState, used, t);
  };
  /** The stones of a turning totem have landed: show the new light, then let the move play out. */
  const land = (token?: object) => {
    const l = landing.current;
    if (!l || (token && l.token !== token)) return;
    landing.current = undefined;
    setTurning(undefined);
    audio.play('zap');
    lock.current = Date.now() + LAND * 1000;
    l.settle();
  };
  /** What a move decides: a swallowed beam, a win, the last move spent, or nothing yet. */
  const outcome = (nextState: PlayState, used: number, t: Trace) => {
    if (nextState.absorbed) {
      // Swallowed: nothing more can be played. The board plays the absorption (the light reaching the hole, the hole
      // growing, the light dragged in, the world going dark) and reports when it is over; the defeat screen, with a
      // rewind offered, waits for that. A fallback timer covers a board that cannot report (the app sent away).
      lock.current = Number.MAX_SAFE_INTEGER;
      const token = {};
      devour.current = token;
      later((ABYSS_SECONDS + 3) * 1000, () => devourDone(token));
    } else if (t.won) {
      lock.current = Number.MAX_SAFE_INTEGER;
      const travel = Math.max(...Object.values(t.activatedAt)) / BEAM_SPEED;
      later(travel * 1000, () => { audio.play('charge'); audio.haptic(); });
      later((travel + CHARGE_TIME) * 1000, () => { audio.play('win'); audio.haptic('success'); setCelebrate(true); });
      later((travel + CHARGE_TIME + 1.5) * 1000, () => finishLevel(nextState, used, t));
    } else {
      const left = level.maxMoves - used;
      if (left <= 0) { lock.current = Number.MAX_SAFE_INTEGER; later(900, () => go('fail')); }
    }
  };
  /** The absorption has finished (reported by the board, or by the fallback timer): once per failure. */
  const devourDone = (token?: object) => {
    if (!devour.current || (token && devour.current !== token)) return;
    devour.current = undefined;
    setDevourOver(true);
  };
  /** A loss to the Devourer taken back (retry, rewind): its sequence, sounds and darkness all stop. */
  const cancelDevour = () => {
    devour.current = undefined;
    setDevourOver(false);
    audio.stop('abyss'); audio.stop('swallow'); audio.setHush(1);
  };
  const undo = () => {
    if (screen !== 'game' || win || turning || !history.length || lock.current > Date.now() + 1000) return;
    const last = history[history.length - 1]!;
    cancelHint();
    setPreviewId(undefined);
    setHistory(h => h.slice(0, -1));
    setPlay(last.play); setMoves(last.moves);
    audio.play('rotate', .6); audio.haptic();
  };
  /** After the Devourer swallows the light: step back to the board as it was before that move. */
  const rewind = () => {
    const last = history[history.length - 1];
    if (!last) { begin(levelId); go('game'); return; }
    clearTimers(); cancelHint();
    landing.current = undefined; setTurning(undefined);
    cancelDevour();
    setHistory(h => h.slice(0, -1));
    setPlay(last.play); setMoves(last.moves); setPreviewId(undefined); setFailReason('moves');
    lock.current = 0;
    audio.play('rotate', .6); audio.haptic();
    go('game');
  };
  const showHint = () => {
    if (screen !== 'game' || win || turning) return;
    // Already searching this exact board; let that search finish.
    if (hintJob.current?.play === play) return;
    cancelHint();
    // Late-game boards can take a noticeable moment to search on a phone; slicing keeps the scene animating meanwhile.
    const job = { play, cancel: () => undefined as void };
    hintJob.current = job;
    job.cancel = solveSliced(level, play, path => {
      if (hintJob.current !== job) return;
      hintJob.current = undefined;
      if (path?.length) setHint(path[0]);
    });
  };
  const newHeart = () => worldShards(progress, level.chapter) === SHARDS_PER_WORLD && !seen.hearts.includes(level.chapter);
  const advance = () => {
    if (level.index === LEVELS_PER_CHAPTER && !seen.outros.includes(level.chapter)) { go('outro'); return; }
    if (levelId >= levels.length) { openMap(levels.length); return; }
    const proceed = () => start(levelId + 1);
    // The count restarts only when an ad really played; with none loaded (offline), the next Continue tries again.
    if (!removeAds.adFree && ads.isDue(save.data.levelsSinceAd)) void ads.show().then(shown => { if (shown) save.resetAdCounter(); proceed(); });
    else proceed();
  };
  const continueAfterWin = () => {
    if (newHeart()) { setForging(level.chapter); go('forge'); return; }
    advance();
  };
  const afterForge = () => {
    if (forging !== undefined) save.markSeen('hearts', forging);
    if (hearts.length === 5 && !seen.ending) { go('ending'); return; }
    setForging(undefined);
    advance();
  };
  const afterOutro = () => {
    save.markSeen('outros', level.chapter);
    if (level.chapter === 4) openMap(levels.length); else start(levelId + 1);
  };
  const watch = (kind: StoryKind, chapter: number) => {
    audio.play('whoosh');
    setReplay({ kind, chapter });
    if (kind === 'forge') setForging(chapter);
    go(kind);
  };
  const endReplay = () => { setReplay(undefined); setForging(undefined); openMap(mapFocus); };
  const reset = () => { save.reset(); playGames.resetCloud(); clearTimers(); setLevelId(1); setWin(undefined); setConfirmReset(false); go('home'); };
  /** A store or Play Games message; Settings closes so it can be read. */
  const tell = (message: string) => { setModal(m => (m === 'settings' ? undefined : m)); setNotice(message); };
  const restoreNoAds = async () => {
    const result = await removeAds.restore();
    tell(result === 'restored' ? 'Ad-Free restored. Enjoy the journey without ads!'
      : result === 'none' ? 'This Google Play account has not bought Ad-Free.' : 'Could not reach Google Play. Check your connection and try again.');
  };
  const signInPlayGames = async () => { if (!(await playGames.signIn())) tell('Google Play Games sign-in did not finish. You can try again any time from Settings.'); };
  const openPlayGames = async (screen: 'achievements' | 'leaderboard') => {
    if (!(await playGames.open(screen))) tell('Could not open Google Play Games. Check your connection and try again.');
  };
  const homeExtras: HomeExtra[] = [];
  if (playGames.status !== 'unavailable') {
    homeExtras.push({ icon: 'trophy', caption: 'Awards', label: 'Google Play Games achievements', onPress: () => void openPlayGames('achievements') });
    if (playGames.hasLeaderboard) homeExtras.push({ icon: 'podium', caption: 'Ranks', label: 'Crystal Shards leaderboard', onPress: () => void openPlayGames('leaderboard') });
  }
  /** Remove Ads for Home, Pause and Settings alike: one price, and one purchase handler that opens Google Play directly. */
  const adFree = useMemo<AdFree | undefined>(() => (removeAds.supported
    ? { owned: removeAds.adFree, price: removeAds.price, busy: removeAds.busy, buy: removeAds.buy } : undefined),
  [removeAds.supported, removeAds.adFree, removeAds.price, removeAds.busy, removeAds.buy]);
  /** Home's icon has no room for Google Play's answer, so anything worth saying appears as a notice. */
  const buyFromHome = () => void removeAds.buy().then(status => { const message = purchaseNotice[status]; if (message) tell(message); });
  // The 3D World is memoised, so it gets stable callbacks; the ref always points at this render's rotate().
  const rotateRef = useRef(rotate);
  rotateRef.current = rotate;
  const onWorldTap = useCallback((id: string) => rotateRef.current(id), []);
  const onWorldBlocked = useCallback(() => { audio.play('bonk'); audio.haptic('error'); }, []);
  const onBoardReady = useCallback((key: string) => setReadyBoard(key), []);
  const onWorldPreview = useCallback((id: string | undefined) => setPreviewId(id), []);
  const landRef = useRef(land);
  landRef.current = land;
  const onTurnDone = useCallback(() => landRef.current(), []);
  const devourDoneRef = useRef(devourDone);
  devourDoneRef.current = devourDone;
  const onDevourDone = useCallback(() => devourDoneRef.current(), []);
  const ready = (fontsLoaded || !!fontError) && save.loaded;
  const dusk = screen === 'fail' && level.chapter === 2 ? 1 : screen === 'game' && level.chapter === 2 && level.maxMoves ? (moves / level.maxMoves) * .8 : 0;

  const content = <>
    {screen === 'splash' && <Splash ready={ready} onDone={() => go(seen.prologue ? 'home' : 'prologue')} />}
    {screen === 'prologue' && <Prologue onDone={replay ? endReplay : () => { save.markSeen('prologue'); if (next === 1) start(1); else go('home'); }} />}
    {screen === 'home' && <Home total={total} next={next} chapter={homeChapter} hearts={hearts}
      onPlay={() => (next > levels.length ? openMap(levels.length) : start(next))} onMap={() => openMap()} onSettings={() => setModal('settings')} extras={homeExtras}
      adFree={adFree} onAdFree={buyFromHome} />}
    {screen === 'map' && <JourneyMap progress={progress} focus={mapFocus} scroll={mapScroll} seen={seen} hearts={hearts} onChapter={setMapChapter}
      onPlay={id => start(id)} onBack={() => go('home')} onWatch={watch} />}
    {screen === 'intro' && <ChapterIntro key={replay?.chapter ?? level.chapter} chapter={replay?.chapter ?? level.chapter}
      onDone={replay ? endReplay : () => { save.markSeen('intros', level.chapter); go('game'); }} />}
    {screen === 'game' && <Gameplay key={`${levelId}:${attempt}`} level={level} moves={moves} lit={shownTrace.activated.length} litIds={shownTrace.activated} won={won}
      loading={readyBoard !== `${levelId}:${attempt}`} view={view} onView={() => setView(v => (v === 'tilt' ? 'top' : 'tilt'))}
      celebrate={celebrate} canUndo={history.length > 0 && !play.absorbed} onPause={() => setModal('pause')} onRestart={() => { audio.play('whoosh'); begin(levelId); }}
      onUndo={undo} onHint={showHint} onRotate={rotate} status={status} devoured={!!shownTrace.absorbed} />}
    {screen === 'complete' && win && <Complete level={level} {...win} best={progress[levelId]?.moves ?? win.moves} onNext={continueAfterWin}
      onReplay={() => { begin(levelId); go('game'); }} onHome={() => go('home')} onMap={() => openMap(levelId)} />}
    {screen === 'fail' && <Fail level={level} reason={failReason} onRetry={() => { begin(levelId); go('game'); }} onMap={() => openMap(levelId)}
      onRewind={failReason === 'devoured' && history.length ? rewind : undefined} />}
    {screen === 'outro' && <Outro chapter={replay?.chapter ?? level.chapter} hearts={hearts} onDone={replay ? endReplay : afterOutro} />}
    {screen === 'forge' && forging !== undefined && <Forge chapter={forging} total={replay ? hearts.indexOf(forging) + 1 : hearts.length} onDone={replay ? endReplay : afterForge} />}
    {screen === 'ending' && <Ending onDone={replay ? endReplay : () => { save.markSeen('ending'); go('home'); }} />}
  </>;

  return <ChapterUI.Provider value={worldChapter}>
    <View style={s.root}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />
      <World chapter={screen === 'prologue' ? 0 : worldChapter} mode={worldMode[screen]} level={boardLevel} state={boardState} trace={playing ? shownTrace : trace}
        boardKey={playing ? `${levelId}:${attempt}` : `teaser:${boardLevel.id}`} hint={hint} onTap={onWorldTap} onTurnDone={onTurnDone} onDevourDone={onDevourDone}
        onBlocked={onWorldBlocked} onBoardReady={onBoardReady} insets={insets} dusk={dusk} preview={ghost} previewId={previewId} onPreview={onWorldPreview}
        hearts={hearts} forging={screen === 'forge' ? forging : undefined} mapScroll={mapScroll} progress={progress} view={view} />
      {!save.loaded && save.error ? <SafeAreaView style={s.center}><Panel style={{ maxWidth: 420, width: '100%' }}>
        <GameText size={22} font="cinemaBold" strokeWidth={0} style={{ color: '#fff' }}>Your journey got tangled.</GameText>
        <GameText size={15} font="semi" strokeWidth={0} containerStyle={{ marginVertical: 14 }} style={{ color: '#eef2fb' }}>{save.error}</GameText>
        <ToyButton title="TRY AGAIN" label="Retry loading" height={50} onPress={() => void save.load()} />
        <ToyButton title={confirmReset ? 'YES, START FRESH' : 'START NEW JOURNEY'} label={confirmReset ? 'Confirm erase saved data' : 'Start a new journey'}
          tint="red" height={44} fontSize={15} style={{ marginTop: 12 }} onPress={() => (confirmReset ? reset() : setConfirmReset(true))} />
      </Panel></SafeAreaView> : (fontsLoaded || fontError) && (cinematic.includes(screen)
        ? <SafeAreaView style={s.fill} pointerEvents="box-none">{content}</SafeAreaView>
        : <View style={s.fill} pointerEvents="box-none">{content}</View>)}
      {(notice || (save.error && save.loaded)) && <View style={[s.notice, { bottom: safe.bottom + 10 }]}><Panel style={{ width: '100%' }}>
        <GameText size={14} font="semi" strokeWidth={0} style={{ color: '#fff' }}>{save.error ?? notice}</GameText>
        <ToyButton title={save.error ? 'RETRY SAVE' : 'OK'} height={40} fontSize={15} style={{ marginTop: 8 }}
          onPress={() => (save.error ? save.retrySave() : setNotice(undefined))} />
      </Panel></View>}
      <Curtain visible={curtain} duration={280} />
      {PERF_HUD && <PerfOverlay />}
      {modal === 'settings' && <SettingsModal chapter={worldChapter} settings={save.data.settings} onChange={save.setting} onClose={() => setModal(undefined)}
        onReset={reset} onStory={() => go('prologue')} store={{
          removeAds: adFree && { ...adFree, onRestore: () => void restoreNoAds() },
          onAdPrivacy: privacyForm ? () => void adPrivacy.show().catch(cause => console.warn('Ad privacy form failed', cause)) : undefined,
          playGames: playGames.status !== 'unavailable' ? { signedIn: playGames.status === 'signedIn', onSignIn: () => void signInPlayGames() } : undefined,
        }} />}
      {modal === 'pause' && <PauseModal chapter={worldChapter} settings={save.data.settings} onChange={save.setting} onResume={() => setModal(undefined)}
        onRestart={() => { begin(levelId); go('game'); }} onHome={() => go('home')} onMap={() => openMap(levelId)} adFree={adFree} />}
    </View>
  </ChapterUI.Provider>;
}

export default function App() { return <SafeAreaProvider><GameApp /></SafeAreaProvider>; }

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#05030f', overflow: 'hidden' },
  fill: { ...StyleSheet.absoluteFillObject },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  notice: { position: 'absolute', left: 14, right: 14 },
});
