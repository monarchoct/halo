import { pgTable, text, uuid, integer, numeric, jsonb, timestamp } from 'drizzle-orm/pg-core';

// SQL migrations own the constraints and partial indexes. These mappings are used
// by typed query construction; numeric chain values remain decimal strings.
export const deployments = pgTable('halo_deployments', {
  id: text('id').primaryKey(), chainId: integer('chain_id').notNull(), registry: text('registry').notNull(),
  identityHash: text('identity_hash').notNull(), createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});
export const jobs = pgTable('halo_jobs', {
  id: uuid('id').primaryKey(), deploymentId: text('deployment_id').notNull(), agent: text('agent').notNull(), nonce: numeric('nonce', { precision: 78, scale: 0 }).notNull(),
  payload: jsonb('payload').notNull(), payloadHash: text('payload_hash').notNull(), state: text('state').notNull(),
  availableAt: timestamp('available_at', { withTimezone: true }).notNull(), leaseToken: uuid('lease_token'), leaseOwner: text('lease_owner'),
  leaseUntil: timestamp('lease_until', { withTimezone: true }), attempts: integer('attempts').notNull(), result: jsonb('result'), resultHash: text('result_hash'),
  lastError: text('last_error'), createdAt: timestamp('created_at', { withTimezone: true }).notNull(), updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});
export const outbox = pgTable('halo_outbox', {
  id: uuid('id').primaryKey(), deploymentId: text('deployment_id').notNull(), topic: text('topic').notNull(),
  dedupeKey: text('dedupe_key').notNull(), streamKey: text('stream_key').notNull(), ordinal: integer('ordinal').notNull(), payload: jsonb('payload').notNull(),
  payloadHash: text('payload_hash').notNull(), state: text('state').notNull(), availableAt: timestamp('available_at', { withTimezone: true }).notNull(),
  leaseToken: uuid('lease_token'), leaseOwner: text('lease_owner'), leaseUntil: timestamp('lease_until', { withTimezone: true }),
  attempts: integer('attempts').notNull(), lastError: text('last_error'), createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  preparedPayload: jsonb('prepared_payload'), preparedHash: text('prepared_hash'),
  lastResult: jsonb('last_result'), lastResultHash: text('last_result_hash'),
});
