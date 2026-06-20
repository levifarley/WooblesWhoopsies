import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import fetch from 'node-fetch';

// 1. Initialize the Gemini API client
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const delay = ms => new Promise(res => setTimeout(res, ms));

async function run() {
  const targetUrl = 'https://learn.thewoobles.com'; 
  const cacheFile = 'last_known_state.txt';

  try {
    console.log(`Fetching target website: ${targetUrl}`);
    const response = await fetch(targetUrl);
    const currentHtml = await response.text();

    // 2. Read previous execution's state if it exists
    let previousHtml = '';
    if (fs.existsSync(cacheFile)) {
      previousHtml = fs.readFileSync(cacheFile, 'utf8');
    }

    // Cache current state immediately to disk for the repo update
    fs.writeFileSync(cacheFile, currentHtml, 'utf8');

    // If there is no baseline cache or it's a reset state, skip Gemini and save it
    if (!previousHtml || previousHtml.trim() === "RESET" || previousHtml.trim() === "Empty") {
      console.log("No baseline state found on disk. Baseline initialized. Exiting until next schedule.");
      return;
    }

    console.log("Analyzing content changes with Gemini...");

    const promptPayload = {
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `You are an automated backend data parser. Your sole job is to compare two raw string inputs representing website states and output the differences. Do not talk to me or ask follow-up questions.
              
              Task Instructions:
              1. Disregard ephemeral changes like random session IDs, CSRF tokens, dynamic timestamps, or ad tracking scripts.
              2. If the Old State is a placeholder or if there are no meaningful content, structural, or visual inventory changes, respond with exactly: NO_CHANGES
              3. If genuine changes, text modifications, or new product catalog links are detected, provide a brief, bulleted summary of exactly what was modified or added. Keep it concise enough to fit nicely on a mobile notification lock screen.
              4. Look specifically for new image source links, text modifications, and catalog item links to detect unreleased inventory listings.
              
              OLD STATE RECORD:
              \`\`\`html
              ${previousHtml.substring(0, 50000)}
              \`\`\`
              
              NEW HTML SOURCE TO EVALUATE:
              \`\`\`html
              ${currentHtml.substring(0, 50000)}
              \`\`\``
            }
          ]
        }
      ]
    };

    let responseAi;
    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
      try {
        attempts++;
        responseAi = await ai.models.generateContent({ model: 'gemini-2.5-flash', ...promptPayload });
        break; 
      } catch (error) {
        if ((error.status === 503 || error.status === 429) && attempts < maxAttempts) {
          const waitTime = attempts * 30000;
          console.warn(`Gemini busy (Status ${error.status}). Retrying in ${waitTime / 1000}s...`);
          await delay(waitTime);
        } else {
          throw error;
        }
      }
    }

    const report = responseAi.text.trim();

    if (report === 'NO_CHANGES') {
      console.log("Gemini confirmed: No substantial updates detected.");
      return;
    }

    console.log("Substantial updates detected! Dispatching Pushover notification...");

    if (process.env.PUSHOVER_USER_KEY && process.env.PUSHOVER_TOKEN) {
      const pushoverResponse = await fetch('https://api.pushover.net/1/messages.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: process.env.PUSHOVER_TOKEN,
          user: process.env.PUSHOVER_USER_KEY,
          title: '🚨 New Woobles Drop/Update Found!',
          message: report,
          url: targetUrl,
          url_title: 'Open Woobles Learn'
        })
      });

      if (pushoverResponse.ok) {
        console.log("Pushover notification delivered successfully.");
      } else {
        const errorText = await pushoverResponse.text();
        console.error(`Pushover delivery failed: ${errorText}`);
      }
    }

  } catch (error) {
    console.error("Execution failure:", error);
    process.exit(1);
  }
}

run();
