# r31d.wiki

Small tools for `r31d.wiki`, starting with a fantasy football draft availability survey at:

```text
/fantasy_football/availability
/fantasy_football/ptw_availability
```

## What it does

- Lets each manager enter their name and click calendar dates.
- Saves responses centrally in D1.
- Ranks dates by firm availability first, then in-person availability.
- Allows in-person availability only on Saturdays.
- PTW availability is a separate yes/no survey with its own saved responses.

## Commands

```bash
npm install
npm run dev
npm run build
npm test
```

Generate a migration after changing `db/schema.ts`:

```bash
npm run db:generate
```
