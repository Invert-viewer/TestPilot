import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./e2e',workers:1,fullyParallel:false,timeout:60000,expect:{timeout:10000},reporter:'list',outputDir:'../.acceptance/frontend-browser',use:{baseURL:process.env.TESTPILOT_BASE_URL||'http://127.0.0.1:5173',browserName:'chromium',channel:'msedge',headless:true,viewport:{width:1440,height:1000},trace:'off'}});
