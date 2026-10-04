import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { asc, eq } from "drizzle-orm";

export async function findUserByEmail(email: string) {
  const result = await db
    .select()
    .from(users)
    .where(eq(users.email, email.toLowerCase()))
    .limit(1);
  return result[0] || null;
}

/** The desktop app's one local user (the oldest, if an import brought several). */
export async function findLocalUser() {
  const result = await db
    .select({ id: users.id })
    .from(users)
    .orderBy(asc(users.createdAt))
    .limit(1);
  return result[0] || null;
}

export async function findUserById(id: string) {
  const result = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  return result[0] || null;
}

export async function createUser(data: {
  email: string;
  name: string;
  passwordHash: string;
}) {
  const result = await db
    .insert(users)
    .values({
      email: data.email.toLowerCase(),
      name: data.name,
      passwordHash: data.passwordHash,
    })
    .returning({
      id: users.id,
      email: users.email,
      name: users.name,
      createdAt: users.createdAt,
    });
  return result[0];
}
