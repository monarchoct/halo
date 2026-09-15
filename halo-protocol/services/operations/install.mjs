import fs from 'node:fs';
import {verifySchema} from '../persistence/database.mjs';
import {views} from './reader.mjs';

/** Administrative setup only. This module is not imported by the public service. */
export async function installOperationsProjection({database,role,password}) {
  if(!/^halo_public_[a-f0-9]{12}$/.test(role)||!/^[a-f0-9]{64}$/.test(password))throw new Error('Invalid dedicated reader identity');
  await verifySchema(database);
  const connection=await database.pool.connect();
  try{
    await connection.query('BEGIN');
    await connection.query('SELECT pg_advisory_xact_lock(728164921)');
    await connection.query(fs.readFileSync(new URL('./projections.sql',import.meta.url),'utf8'));
    // Identifiers and literals above accept hex-only generated values, never user SQL.
    await connection.query(`CREATE ROLE "${role}" LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT`);
    await connection.query(`GRANT USAGE ON SCHEMA public TO "${role}"`);
    await connection.query(`GRANT SELECT ON ${views.map(view=>`public.${view}`).join(',')} TO "${role}"`);
    await connection.query(`ALTER ROLE "${role}" SET default_transaction_read_only=on`);
    await connection.query('COMMIT');return {role,projectionVersion:1};
  }catch(error){await connection.query('ROLLBACK');throw error;}finally{connection.release();}
}
