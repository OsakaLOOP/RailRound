import https from 'https';
import fs from 'fs';
import path from 'path';

const DOMAIN = "https://rail.s3xyseia.xyz";
const SITEMAP_URL = `${DOMAIN}/sitemap.xml`;

// API Keys from environment
const BAIDU_TOKEN = process.env.BAIDU_TOKEN;
const BING_API_KEY = process.env.BING_API_KEY;

console.log("Starting Search Engine Sitemap Submission...");

// 1. Google (Ping)
const pingGoogle = () => {
    https.get(`https://www.google.com/ping?sitemap=${encodeURIComponent(SITEMAP_URL)}`, (res) => {
        console.log(`[Google Ping] Status: ${res.statusCode}`);
    }).on('error', (e) => {
        console.error(`[Google Ping] Error: ${e.message}`);
    });
};

// 2. Bing (Ping & Webmaster API)
const submitBing = () => {
    // Standard Ping
    https.get(`https://www.bing.com/ping?sitemap=${encodeURIComponent(SITEMAP_URL)}`, (res) => {
        console.log(`[Bing Ping] Status: ${res.statusCode}`);
    }).on('error', (e) => {
        console.error(`[Bing Ping] Error: ${e.message}`);
    });

    // Webmaster API
    if (BING_API_KEY) {
        const data = JSON.stringify({
            "siteUrl": DOMAIN,
            "urlList": [DOMAIN]
        });

        const options = {
            hostname: 'ssl.bing.com',
            path: `/webmaster/api.svc/json/SubmitUrlbatch?apikey=${BING_API_KEY}`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': data.length
            }
        };

        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', d => body += d);
            res.on('end', () => console.log(`[Bing Webmaster API] Status: ${res.statusCode}, Response: ${body}`));
        });
        req.on('error', e => console.error(`[Bing Webmaster API] Error: ${e.message}`));
        req.write(data);
        req.end();
    } else {
        console.log("[Bing Webmaster API] Skipped: BING_API_KEY not set.");
    }
};

// 3. Baidu (Webmaster API)
const submitBaidu = () => {
    if (BAIDU_TOKEN) {
        const data = `${DOMAIN}/`;

        // Ensure hostname has no protocol
        const host = DOMAIN.replace(/^https?:\/\//, '');
        const options = {
            hostname: 'data.zz.baidu.com',
            path: `/urls?site=${encodeURIComponent(DOMAIN)}&token=${BAIDU_TOKEN}`,
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain',
                'Content-Length': data.length
            }
        };

        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', d => body += d);
            res.on('end', () => console.log(`[Baidu API] Status: ${res.statusCode}, Response: ${body}`));
        });
        req.on('error', e => console.error(`[Baidu API] Error: ${e.message}`));
        req.write(data);
        req.end();
    } else {
        console.log("[Baidu API] Skipped: BAIDU_TOKEN not set.");
    }
};

pingGoogle();
submitBing();
submitBaidu();
