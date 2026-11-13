/**
 * Per-user notification settings.
 * Each flag enables or disables one delivery channel.
 */
export interface NotificationPreferences {
  /** Send notifications by email. */
  email: boolean;

  /** Show notifications inside the app. */
  inApp: boolean;

  isPush: boolean;
}
