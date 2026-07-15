const createSchema = require("../../src/db/schema");
const seedDatabase = require("../../src/db/seed");

function resetDatabase() {
    createSchema();
    seedDatabase();
}

module.exports = resetDatabase;