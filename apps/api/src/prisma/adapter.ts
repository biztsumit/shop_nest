import { PrismaPg } from '@prisma/adapter-pg';

// The ONE way this app connects Prisma to PostgreSQL (the server, scripts, seed and tests).
//
// `-c TimeZone=UTC` sets each connection's session time zone to UTC. Prisma's pg adapter sends
// a Date as plain text without a UTC offset ("2026-10-26 20:00:00"), and PostgreSQL reads such
// text in the SESSION's time zone. On a server set to India time, every timestamp the app wrote
// landed 5½ hours early, while times made by the database itself (now(), DEFAULT
// CURRENT_TIMESTAMP) were right, so the two disagreed. Found by the sales report's
// day-by-day grouping; invisible on databases that already run in UTC.
export const pgAdapter = (connectionString: string | undefined): PrismaPg =>
  new PrismaPg({ connectionString, options: '-c TimeZone=UTC' });
