import { userRepository } from '../repositories/user.repository';
import { NotificationPreferences } from '../models/notification-preferences';
import { NotificationChannel } from '../models/notification-channel';
import { logger } from '../lib/logger';

export interface DispatchOptions {
  channels?: NotificationChannel[];
  force?: boolean;
}

const DEFAULT_PREFERENCES: NotificationPreferences = {
  email: true,
  isPush: true,
  inApp: true,
};

export class NotificationService {
  async dispatch(userId: string, message: string, options: DispatchOptions = {}) {
    const preferences = await this.getPreferences(userId);
    const channels = (options.channels ?? ['email', 'push', 'in_app']).filter((channel) =>
      options.force ? true : this.isEnabled(preferences, channel),
    );

    for (const channel of channels) {
      logger.info(`Dispatching notification to ${userId} via ${channel}`);
      await this.send(channel, userId, message);
    }
    return channels;
  }

  isEnabled(preferences: NotificationPreferences, channel: NotificationChannel) {
    switch (channel) {
      case 'email': return preferences.email;
      case 'push': return preferences.isPush;
      case 'in_app': return preferences.inApp;
      default: return false;
    }
  }

  async getPreferences(userId: string): Promise<NotificationPreferences> {
    const user = await userRepository.findById(userId);
    return user.notificationPreferences;
  }

  async updatePreferences(userId: string, preferences: Partial<NotificationPreferences>) {
    const current = await this.getPreferences(userId);
    const next = { ...DEFAULT_PREFERENCES, ...current, ...preferences };
    await userRepository.update(userId, { notificationPreferences: next });
    return next;
  }

  private async send(channel: NotificationChannel, userId: string, message: string) {
    // Delegates to the channel-specific providers.
  }
}
