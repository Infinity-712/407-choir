import {defineConfig} from '@playwright/test';
const webURL = `http://localhost:${process.env.WEB_PORT ?? '5173'}`;
const backendURL = `http://localhost:${process.env.PORT ?? '3001'}`;
// Worktrees can share port choices. Refuse an unknown existing server unless the
// operator explicitly confirms it belongs to this checkout.
const reuseExistingServer=process.env.PW_REUSE_SERVER==='1';
export default defineConfig({testDir:'./tests/browser',timeout:90000,expect:{timeout:15000},fullyParallel:false,workers:1,reporter:'list',use:{baseURL:webURL,channel:'msedge',viewport:{width:1440,height:1000},launchOptions:{args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required']},permissions:['microphone'],trace:'retain-on-failure'},webServer:[{command:'npx tsx server/index.ts',url:`${backendURL}/api/health`,reuseExistingServer,timeout:30000},{command:'npx vite --host 0.0.0.0',url:webURL,reuseExistingServer,timeout:30000}]});
