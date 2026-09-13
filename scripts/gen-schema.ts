import { writeFile } from 'node:fs/promises';
import { jsonSchema } from '../src/config/plans';

const out = new URL('../schema/plans.schema.json', import.meta.url);
await writeFile(out, JSON.stringify(jsonSchema(), null, 2) + '\n');
console.log(`wrote ${out.pathname}`);
