# Railway Environment Variables Required

Set these in Railway dashboard → meowchat-engine service → Variables:

| Variable | Description | Where to get |
|----------|-------------|--------------|
| `GEMINI_API_KEY` | Google Gemini API key | [console.cloud.google.com](https://console.cloud.google.com) |
| `REDIS_URL` | Redis connection string | Railway Redis addon → Variables → `REDIS_URL` |
| `LINE_CHANNEL_SECRET` | LINE OA channel secret | [LINE Developers Console](https://developers.line.biz) |
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE OA access token | LINE Developers Console |
| `ADMIN_API_KEY` | Secret key for `/admin/bots` API | Generate any random string |
| `PORT` | HTTP port (Railway sets this automatically) | Leave unset — Railway injects it |

## Railway Setup Steps

1. **Add Redis**: Railway dashboard → New service → Redis. Copy `REDIS_URL` from its Variables tab into the engine service Variables.
2. **Set all Variables** from the table above in the engine service.
3. **LINE Webhook URL**: After deploy, set the webhook URL in LINE Developers Console:
   ```
   https://<your-railway-domain>/webhook/line/<botId>
   ```
   Example: `https://meowchat-engine-production.up.railway.app/webhook/line/demo-bot-001`

## Health Check

```
GET /health
```

Returns:
```json
{ "ok": true, "redis": true, "ts": "2026-01-01T00:00:00.000Z" }
```

## Register a Bot

```bash
curl -X POST https://<domain>/admin/bots \
  -H "x-admin-key: <ADMIN_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{ "botId": "my-bot-001", ... }'
```

See `src/types/index.ts` for the full `BotConfig` schema.
