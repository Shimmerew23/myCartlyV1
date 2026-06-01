const { PrismaClient } = require('@prisma/client');
const logger = require('../utils/logger');

const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

const connectPrisma = async () => {
  try {
    await prisma.$connect();
    logger.info('PostgreSQL (Prisma) connected');
  } catch (err) {
    logger.error(`Prisma connection failed: ${err.message}`);
    throw err; // Postgres is the system of record; fail fast like Mongo does
  }
};

const disconnectPrisma = async () => {
  await prisma.$disconnect();
  logger.info('Prisma disconnected');
};

module.exports = { prisma, connectPrisma, disconnectPrisma };
