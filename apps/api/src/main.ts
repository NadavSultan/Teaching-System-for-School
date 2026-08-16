import 'reflect-metadata';
import { createApp } from './bootstrap.js';

const app = await createApp();
await app.listen(Number(process.env.API_PORT ?? 4000), '0.0.0.0');
