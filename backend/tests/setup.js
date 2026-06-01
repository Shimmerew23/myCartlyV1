const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env.test') });

const { execSync } = require('child_process');
const { prisma } = require('../config/prisma');

beforeAll(() => {
  // Apply migrations to the test database
  execSync('npx prisma migrate deploy', {
    env: process.env,
    stdio: 'inherit',
    cwd: path.resolve(__dirname, '..'),
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});
