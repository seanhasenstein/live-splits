import { type Db, MongoClient, ObjectId } from "mongodb";

const globalForMongo = globalThis as unknown as { _mongoClient?: Promise<MongoClient> };

function connect(): Promise<MongoClient> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set (add it to .env.local)");
  return new MongoClient(uri).connect();
}

/** One client per process, reused across dev hot reloads and serverless invocations. */
export function getClient(): Promise<MongoClient> {
  globalForMongo._mongoClient ??= connect();
  return globalForMongo._mongoClient;
}

export async function getDb(): Promise<Db> {
  const name = process.env.MONGODB_DB;
  if (!name) throw new Error("MONGODB_DB is not set (add it to .env.local)");
  return (await getClient()).db(name);
}

/** New document id: an ObjectId rendered as a hex string. */
export function newId(): string {
  return new ObjectId().toHexString();
}
