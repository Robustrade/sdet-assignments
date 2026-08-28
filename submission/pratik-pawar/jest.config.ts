import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  collectCoverageFrom: ['src/**/*.ts'],
  clearMocks: true,
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
  reporters: [
    'default',
    [
      'jest-junit',
      {
        outputDirectory: 'reports/junit',
        outputName: 'junit.xml',
      },
    ],
    [
      'jest-html-reporters',
      {
        publicPath: 'reports',
        filename: 'jest-report.html',
        expand: true,
        openReport: false,
        pageTitle: 'Jest Interactive Report',
        inlineSource: true,
        includeFailureMsg: true,
        includeConsoleLog: true,
        customInfos: [
          { title: 'Project', value: 'pratik-pawar' },
          { title: 'Generated', value: new Date().toISOString() },
        ]
      },
    ],
  ],
};

export default config;
