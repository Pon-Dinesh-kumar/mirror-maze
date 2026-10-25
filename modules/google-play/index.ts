import { NativeModule, requireOptionalNativeModule } from 'expo';

/** Google Play Games Services v2 (android/…/PlayGamesModule.kt). Android only; null elsewhere. */
declare class PlayGamesModule extends NativeModule {
  /** Whether the game's Play Console project id was built in (app.json, google-play plugin). Nothing else may be called without it. */
  isConfigured(): boolean;
  isAuthenticated(): Promise<boolean>;
  signIn(): Promise<boolean>;
  unlock(id: string): Promise<void>;
  submitScore(id: string, score: number): Promise<void>;
  showAchievements(): Promise<void>;
  showLeaderboard(id: string): Promise<void>;
  /** Opens the named cloud save and returns its contents (null when new). It stays open for commitSave or discardSave. */
  openSave(name: string): Promise<string | null>;
  commitSave(data: string, description: string, progress: number): Promise<void>;
  discardSave(): Promise<void>;
}

export type PurchaseStatus = 'purchased' | 'pending' | 'cancelled' | 'owned' | 'unavailable' | 'failed';
export interface PurchaseOutcome { status: PurchaseStatus; message: string; products: string[] }
export interface StoreProduct { id: string; title: string; price: string | null }

/** Google Play Billing for one-time products (android/…/PlayBillingModule.kt). Android only; null elsewhere. */
declare class PlayBillingModule extends NativeModule<{ onPurchase(outcome: PurchaseOutcome): void }> {
  product(id: string): Promise<StoreProduct | null>;
  owned(id: string): Promise<boolean>;
  buy(id: string): Promise<PurchaseOutcome>;
}

export const PlayGames = requireOptionalNativeModule<PlayGamesModule>('PlayGames');
export const PlayBilling = requireOptionalNativeModule<PlayBillingModule>('PlayBilling');
