import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CloudSave, completedDevelopmentSave, decodeSave, DEVELOPMENT_STORAGE_KEY, freshSave, mergeSaves, SaveData, Settings, STORAGE_KEY } from './storage';
import { recordResult } from '../game/progress';

export function useSave() {
  const [data, setData] = useState<SaveData>(freshSave);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const revision = useRef(0);
  const load = useCallback(async () => {
    setError(undefined);
    try {
      const key = __DEV__ ? DEVELOPMENT_STORAGE_KEY : STORAGE_KEY;
      const raw = await AsyncStorage.getItem(key);
      const loaded = raw === null ? freshSave() : decodeSave(raw);
      setData(__DEV__ ? completedDevelopmentSave(loaded) : loaded);
      setLoaded(true);
    } catch (cause) {
      console.error('Could not load Mirror Maze save', cause);
      setError('Your saved journey could not be loaded. Retry, or explicitly reset it to start fresh.');
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!loaded) return;
    const currentRevision = ++revision.current;
    setSaving(true);
    queue.current = queue.current.then(async () => {
      try {
        const key = __DEV__ ? DEVELOPMENT_STORAGE_KEY : STORAGE_KEY;
        await AsyncStorage.setItem(key, JSON.stringify(data));
        if (currentRevision === revision.current) { setSaving(false); setError(undefined); }
      } catch (cause) {
        console.error('Could not persist Mirror Maze save', cause);
        if (currentRevision === revision.current) {
          setSaving(false);
          setError('Progress is in memory but could not be saved. Check storage access and tap Retry save.');
        }
      }
    });
  }, [data, loaded]);
  const complete = useCallback((id: number, stars: number, moves: number) =>
    setData(previous => ({ ...previous, progress: recordResult(previous.progress, id, stars, moves), levelsSinceAd: previous.levelsSinceAd + 1 })), []);
  const resetAdCounter = useCallback(() => setData(previous => ({ ...previous, levelsSinceAd: 0 })), []);
  const markSeen = useCallback((kind: 'prologue' | 'ending' | 'intros' | 'outros' | 'hearts', chapter = 0) => setData(previous => {
    const seen = previous.seen;
    if (kind === 'prologue' || kind === 'ending') return seen[kind] ? previous : { ...previous, seen: { ...seen, [kind]: true } };
    return seen[kind].includes(chapter) ? previous : { ...previous, seen: { ...seen, [kind]: [...seen[kind], chapter] } };
  }), []);
  const setting = useCallback((key: keyof Settings, value: boolean) =>
    setData(previous => ({ ...previous, settings: { ...previous.settings, [key]: value } })), []);
  const reset = useCallback(() => { setData(freshSave()); setLoaded(true); }, []);
  /** Takes in the journey from the Google Play Games cloud save (see mergeSaves). */
  const adopt = useCallback((cloud: CloudSave) => setData(previous => mergeSaves(previous, cloud)), []);
  return { data, loaded, error, saving, load, complete, setting, reset, markSeen, resetAdCounter, adopt,
    retrySave: () => setData(previous => ({ ...previous })) };
}
