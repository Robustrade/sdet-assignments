import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export function createDatabase(): DatabaseSync {
    const nodeMajorVersion = Number(process.versions.node.split('.')[0]);

    if (nodeMajorVersion < 22) {
        throw new Error(
            `node:sqlite requires Node.js >= 22. Current version: ${process.versions.node}`
        );
    }

    const db = new DatabaseSync(':memory:');

    const schemaPath = fileURLToPath(
        new URL('./schema.sql', import.meta.url)
    );

    const schema = readFileSync(path.resolve(schemaPath), 'utf-8');

    db.exec(schema);

    return db;
}

export function runInTransaction<T>(
    db: DatabaseSync,
    operation: () => T
): T {
    db.exec('BEGIN');

    try {
        const result = operation();

        db.exec('COMMIT');

        return result;
    } catch (error) {
        db.exec('ROLLBACK');
        throw error;
    }
}