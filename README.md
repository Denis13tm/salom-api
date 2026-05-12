# Salom API

NestJS backend (PostgreSQL, Redis, Prisma). Alohida repo — operator web va mobil ilovalar alohida repolarda.

## Bog‘liq repolar

| Repo | URL |
|------|-----|
| Operator / admin web | [salom-web](https://github.com/Denis13tm/salom-web) |
| Haydovchi Android | [salom-driver-android](https://github.com/Denis13tm/salom-driver-android) |
| Haydovchi iOS | [salom-driver-ios](https://github.com/Denis13tm/salom-driver-ios) |

## Lokal ish

```bash
cp .env.example .env
docker compose up -d
npm ci
npx prisma migrate deploy
npm run start:dev
```

Health: `GET http://localhost:3000/api/v1/health`

## Render (production)

- **Build:** `npm ci && npm run build && npx prisma generate --schema=prisma/schema.prisma`
- **Start:** `npm run start:render`

## Eski monorepo

`Denis13tm/salom-taxi` arxivlangan; tarix va eski commitlar u yerda saqlanadi.
