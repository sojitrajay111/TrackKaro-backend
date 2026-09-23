export interface AppConfig {
  port: number;
  mongoUri: string;
  jwt: {
    accessSecret: string;
    accessTtl: string;
    refreshSecret: string;
    refreshTtl: string;
  };
  corsOrigins: string[];
  geminiApiKey: string;
  openaiApiKey: string;
  email: {
    user: string;
    passcode: string;
  };
  deals: {
    /** 'provider' (default, production target) tries real marketplace providers only, e.g.
     * Cuelinks. 'legacy' uses the old Gemini-generated deal finder, kept for comparison during
     * the rollout. See deals.service.ts#discoverDeals. */
    engineMode: 'provider' | 'legacy';
  };
  cuelinks: {
    apiKey: string;
    channelId: string;
  };
  rapidapi: {
    key: string;
  };
}

export default (): AppConfig => ({
  port: parseInt(process.env.PORT ?? '4000', 10),
  mongoUri: process.env.MONGO_URI ?? 'mongodb://localhost:27017/trackkaro',
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET ?? '',
    accessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
    refreshSecret: process.env.JWT_REFRESH_SECRET ?? '',
    refreshTtl: process.env.JWT_REFRESH_TTL ?? '30d',
  },
  corsOrigins: (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  geminiApiKey: process.env.GEMINI_API_KEY ?? '',
  openaiApiKey: process.env.OPENAI_API_KEY ?? '',
  email: {
    user: process.env.EMAIL_USER ?? '',
    passcode: process.env.EMAIL_PASSCODE ?? '',
  },
  deals: {
    engineMode: process.env.DEALS_ENGINE_MODE === 'legacy' ? 'legacy' : 'provider',
  },
  cuelinks: {
    apiKey: process.env.CUELINKS_API_KEY ?? '',
    channelId: process.env.CUELINKS_CHANNEL_ID ?? '',
  },
  rapidapi: {
    key: process.env.RAPIDAPI_KEY ?? '',
  },
});
