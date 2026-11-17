const transform = { '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.json' }] };

module.exports = {
  projects: [
    {
      displayName: 'unit',
      testMatch: ['<rootDir>/src/tests/unit/**/*.test.ts'],
      transform,
      testEnvironment: 'node',
    },
    {
      displayName: 'integration',
      testMatch: ['<rootDir>/src/tests/integration/**/*.test.ts'],
      transform,
      testEnvironment: 'node',
      testTimeout: 15000,
    },
  ],
  collectCoverageFrom: ['src/**/*.ts', '!src/tests/**', '!src/server.ts'],
  coverageDirectory: 'coverage',
};
