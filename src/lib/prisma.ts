import { PrismaClient } from '@prisma/client';

if (!process.env.DATABASE_URL || process.env.DATABASE_URL.trim() === '') {
  throw new Error('[Prisma] Fatal configuration error: DATABASE_URL environment variable is missing or empty.');
}

const prismaClientSingleton = () => {
  return new PrismaClient();
};

declare global {
  var prismaGlobal: undefined | ReturnType<typeof prismaClientSingleton>;
}

export const prisma = globalThis.prismaGlobal ?? prismaClientSingleton();

if (process.env.NODE_ENV !== 'production') globalThis.prismaGlobal = prisma;
