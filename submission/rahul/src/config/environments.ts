export const environments = {
  local: {
    baseUrl: 'http://localhost:3000'
  },

  qa: {
    baseUrl: 'https://qa.example.com'
  },

  staging: {
    baseUrl: 'https://staging.example.com'
  }
} as const;