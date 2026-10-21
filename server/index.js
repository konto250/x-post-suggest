import http from 'node:http';
import handler from './handler.js';
import { readConfig } from './config.js';
const {port}=await readConfig();
const server=http.createServer(handler);
server.requestTimeout=120000;
server.listen(port,'127.0.0.1',()=>console.log(`ローカルURL: http://localhost:${port}`));
