import { NotificationsService } from './notifications.service';

const sendEachForMulticast = jest.fn();

jest.mock('firebase-admin/app', () => ({
  cert: jest.fn((c) => c),
  getApps: jest.fn(() => []),
  getApp: jest.fn(),
  initializeApp: jest.fn(() => ({ name: 'test-app' })),
}));
jest.mock('firebase-admin/messaging', () => ({
  getMessaging: jest.fn(() => ({ sendEachForMulticast })),
}));

const CREDS = { projectId: 'p', clientEmail: 'c@p.iam.gserviceaccount.com', privateKey: 'k' };

/** Minimal chainable Mongoose stand-ins: only what NotificationsService touches. */
function makeService(creds: typeof CREDS | null, tokens: string[] = []) {
  const exec = <T>(value: T) => ({ exec: jest.fn().mockResolvedValue(value) });
  const userModel = {
    updateOne: jest.fn(() => exec({})),
    updateMany: jest.fn(() => exec({})),
    findById: jest.fn(() => ({
      select: () => ({
        lean: () => exec({ fcmTokens: tokens.map((token) => ({ token, platform: 'android' })) }),
      }),
    })),
  };
  const notificationModel = { create: jest.fn().mockResolvedValue({}) };
  const config = {
    get: jest.fn(() => creds ?? { projectId: '', clientEmail: '', privateKey: '' }),
  };
  const service = new NotificationsService(
    notificationModel as any,
    userModel as any,
    config as any,
  );
  return { service, userModel, notificationModel };
}

describe('NotificationsService push (FCM)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('saves the notification but sends nothing without Firebase credentials', async () => {
    const { service, notificationModel } = makeService(null, ['tok-a'.repeat(5)]);
    await service.create('u1', { title: 'T', message: 'M', type: 'insight' as any });
    expect(notificationModel.create).toHaveBeenCalled();
    expect(sendEachForMulticast).not.toHaveBeenCalled();
  });

  it('moves a device token to the account that registers it, newest kept', async () => {
    const { service, userModel } = makeService(CREDS);
    await service.registerPushToken('u1', '  fcm-token-1  ', 'ios');

    expect(userModel.updateMany).toHaveBeenCalledWith(
      { 'fcmTokens.token': 'fcm-token-1' },
      { $pull: { fcmTokens: { token: 'fcm-token-1' } } },
    );
    const [, update] = (userModel.updateOne as jest.Mock).mock.calls[0];
    expect(update.$push.fcmTokens.$each[0]).toMatchObject({
      token: 'fcm-token-1',
      platform: 'ios',
    });
    expect(update.$push.fcmTokens.$slice).toBe(-10);
  });

  it("sends every new notification to all of the user's devices", async () => {
    const { service } = makeService(CREDS, ['tok-1', 'tok-2']);
    sendEachForMulticast.mockResolvedValue({
      failureCount: 0,
      responses: [{ success: true }, { success: true }],
    });

    await service.create('u1', {
      title: 'Budget alert',
      message: 'Food is at 80%',
      type: 'insight' as any,
    });

    expect(sendEachForMulticast).toHaveBeenCalledTimes(1);
    const msg = sendEachForMulticast.mock.calls[0][0];
    expect(msg.tokens).toEqual(['tok-1', 'tok-2']);
    expect(msg.notification).toEqual({ title: 'Budget alert', body: 'Food is at 80%' });
    expect(msg.data).toMatchObject({ type: 'insight', open: 'notifications' });
  });

  it('forgets tokens FCM reports as dead, keeps the rest', async () => {
    const { service, userModel } = makeService(CREDS, ['dead', 'alive', 'flaky']);
    sendEachForMulticast.mockResolvedValue({
      failureCount: 2,
      responses: [
        { success: false, error: { code: 'messaging/registration-token-not-registered' } },
        { success: true },
        { success: false, error: { code: 'messaging/internal-error' } },
      ],
    });

    await service.create('u1', { title: 'T', message: 'M', type: 'insight' as any });

    expect(userModel.updateOne).toHaveBeenCalledWith(
      { _id: 'u1' },
      { $pull: { fcmTokens: { token: { $in: ['dead'] } } } },
    );
  });

  it('a push failure never fails creating the notification', async () => {
    const { service, notificationModel } = makeService(CREDS, ['tok-1']);
    sendEachForMulticast.mockRejectedValue(new Error('network down'));
    await expect(
      service.create('u1', { title: 'T', message: 'M', type: 'insight' as any }),
    ).resolves.toBeUndefined();
    expect(notificationModel.create).toHaveBeenCalled();
  });
});
