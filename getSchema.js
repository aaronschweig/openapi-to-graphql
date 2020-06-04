#!/usr/bin/env node

const axios = require('axios').default;
const { writeFileSync } = require('fs');

const [, , url, ...args] = process.argv;

axios.get(url || 'http://localhost:3000/auth/openapi-json').then(({ data }) => {
  writeFileSync('openapi.json', JSON.stringify(data, null, 2));
});
