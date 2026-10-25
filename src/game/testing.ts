/**
 * Test builds only: set to true to build an APK where every level is open from the start, so testers can jump to any
 * level from the journey map. Shards, Hearts and story moments are still earned by really playing. A source constant
 * (like PERF_HUD), so a cached bundle can never carry it into a normal build; a test keeps it false in the repository.
 */
export const UNLOCK_ALL: boolean = false;

/** Whether a level can be played: the next level and every cleared one, or any level in a test build. */
export const isOpen = (id: number, next: number) => UNLOCK_ALL || id <= next;
