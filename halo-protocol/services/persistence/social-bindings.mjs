import { z } from 'zod';
import { createJobStore } from './store.mjs';

const address = value => z.string().regex(/^0x[a-fA-F0-9]{40}$/).parse(value).toLowerCase();
const platform = z.enum(['x', 'fomo']);
const method = z.enum(['oauth', 'browser-session']);
const state = z.enum(['connected', 'credentials-expired', 'disconnected']);
const signature = z.string().regex(/^0x[0-9a-fA-F]{130}$/);
const secretRef = z.string().regex(/^[a-f0-9]{32,64}$/);
const connectRequestFields = z.object({
  agent: z.string().regex(/^0x[a-fA-F0-9]{40}$/), platform, profileUrl: z.string().url().max(300), method,
  connectedBy: z.string().regex(/^0x[a-fA-F0-9]{40}$/), connectMessage: z.string().min(1).max(4000),
  connectSignature: signature, secretRef: secretRef.optional(),
}).strict();

/** Mirrors services/persistence/inboxes.mjs: deterministic identity, request-before-network,
 * unique constraints, no silent replacement of a connected account. */
export async function createSocialBindingStore({ database, deployment }) {
  const { deploymentId } = await createJobStore({ database, deployment });
  const pool = database.pool;
  return {
    deploymentId,
    /** A connected binding's profile_url cannot change underneath an existing connection;
     * disconnect first. Safe under concurrency: the upsert's WHERE clause and row lock make
     * the accept/reject decision atomic, and the follow-up read observes that same outcome. */
    async connect(request) {
      const value = connectRequestFields.parse(request);
      const agent = address(value.agent), connectedBy = address(value.connectedBy);
      await pool.query(`INSERT INTO halo_social_bindings(deployment_id,agent,platform,profile_url,method,connected_by,connect_message,connect_signature,state,secret_ref)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'connected',$9)
        ON CONFLICT (deployment_id,agent,platform) DO UPDATE SET
          profile_url=EXCLUDED.profile_url, method=EXCLUDED.method, connected_by=EXCLUDED.connected_by,
          connect_message=EXCLUDED.connect_message, connect_signature=EXCLUDED.connect_signature,
          state='connected', secret_ref=EXCLUDED.secret_ref, updated_at=clock_timestamp()
        WHERE halo_social_bindings.state<>'connected' OR halo_social_bindings.profile_url=EXCLUDED.profile_url`,
        [deploymentId, agent, value.platform, value.profileUrl, value.method, connectedBy, value.connectMessage, value.connectSignature, value.secretRef ?? null]);
      const row = (await pool.query('SELECT * FROM halo_social_bindings WHERE deployment_id=$1 AND agent=$2 AND platform=$3',
        [deploymentId, agent, value.platform])).rows[0];
      if (!row || row.state !== 'connected' || row.profile_url !== value.profileUrl)
        throw new Error('Disconnect the existing account before connecting a different one');
      return row;
    },
    async find(agent, platformValue) {
      return (await pool.query('SELECT * FROM halo_social_bindings WHERE deployment_id=$1 AND agent=$2 AND platform=$3',
        [deploymentId, address(agent), platform.parse(platformValue)])).rows[0];
    },
    async list(agent) {
      return (await pool.query('SELECT * FROM halo_social_bindings WHERE deployment_id=$1 AND agent=$2 ORDER BY platform',
        [deploymentId, address(agent)])).rows;
    },
    async setState(agent, platformValue, nextState) {
      const result = await pool.query('UPDATE halo_social_bindings SET state=$4,updated_at=clock_timestamp() WHERE deployment_id=$1 AND agent=$2 AND platform=$3 RETURNING *',
        [deploymentId, address(agent), platform.parse(platformValue), state.parse(nextState)]);
      if (!result.rows.length) throw new Error('No social binding to update');
      return result.rows[0];
    },
    async disconnect(agent, platformValue) {
      const result = await pool.query(`UPDATE halo_social_bindings SET state='disconnected',secret_ref=NULL,updated_at=clock_timestamp()
        WHERE deployment_id=$1 AND agent=$2 AND platform=$3 RETURNING *`,
        [deploymentId, address(agent), platform.parse(platformValue)]);
      if (!result.rows.length) throw new Error('No social binding to disconnect');
      return result.rows[0];
    },
  };
}
