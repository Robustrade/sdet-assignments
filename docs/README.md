<!--




 executeQuery()


const result = await executeQuery(
  "SELECT * FROM employees WHERE id = $1",
  [employeeId]
);




 -->

npx playwright test tests/api/api-client.spec.ts
kill %1
npm run test:report

npx playwright test tests/api/api-client.spec.ts


lsof -nP -iTCP:9324 -sTCP:LISTEN
npx playwright show-report --port 9324
