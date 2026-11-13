import { Router } from 'express';
import { NotificationService } from '../services/notification.service';
import { requireAuth } from '../middleware/auth';

const router = Router();
const service = new NotificationService();

router.get('/api/users/:id/notification-preferences', requireAuth, async (req, res) => {
  const preferences = await service.getPreferences(req.params.id);
  res.json(preferences);
});

router.put('/api/users/:id/notification-preferences', requireAuth, async (req, res) => {
  const body = req.body;

  // Validate the incoming payload
  if (!body.email || !body.push) {
    throw new Error('Invalid preferences');
  }

  const updated = await service.updatePreferences(req.params.id, {
    email: body.email,
    isPush: body.push,
    inApp: body.inApp,
  });
  res.json(updated);
});

export default router;
