import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import fetch from 'node-fetch';

// 1. Initialize the Gemini API client
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function run() {
  const targetUrl = 'https://learn.thewoobles.com'; // <-- CHANGE THIS to the website you want to track
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

    // Cache current state immediately for the next scheduled run
    fs.writeFileSync(cacheFile, currentHtml, 'utf8');

    // If there is no baseline cache, save it and exit early
    if (!previousHtml) {
      console.log("No baseline state found. Saving current HTML as baseline for the next run.");
      return;
    }

    console.log("Analyzing content changes with Gemini...");

    // 3. Prompt Gemini to clean out the noise and identify real changes
    const responseAi = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `You are an automated web tracking assistant. Compare the old HTML source and the new HTML source of a website.
              
              Task:
              1. Disregard ephemeral changes like random session IDs, CSRF tokens, dynamic timestamps, or ad tracking scripts.
              2. If no meaningful content, structural updates, or visual text changes occurred, respond with exactly: NO_CHANGES
              3. If genuine changes or updates are detected, provide a brief, bulleted summary of exactly what was modified or added. Keep it concise enough to fit nicely on a phone notification lock screen.
              4. Look specifically for image and link changes, we are looking specifically for catalog changes in inventory that get put up by company before they should. We want to see these mistakes so we know what is coming out soon for new products.
              
              OLD HTML SOURCE:
              ${previousHtml.substring(0, 50000)}
              
              NEW HTML SOURCE:
              ${currentHtml.substring(0, 50000)}`
            }
          ]
        }
      ]
    });

    const report = responseAi.text.trim();

    // 4. Act on the model's response
    if (report === 'NO_CHANGES') {
      console.log("Gemini confirmed: No substantial updates detected.");
      return;
    }

    console.log("Substantial updates detected! Dispatching Pushover notification...");

    // 5. Fire the alert payload to the phone via Pushover API
    if (process.env.PUSHOVER_USER_KEY && process.env.PUSHOVER_TOKEN) {
      const pushoverResponse = await fetch('https://api.pushover.net/1/messages.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: process.env.PUSHOVER_TOKEN,
          user: process.env.PUSHOVER_USER_KEY,
          title: '🚨 Woobles Update Detected!',
          message: report
        })
      });

      if (pushoverResponse.ok) {
        console.log("Pushover notification delivered successfully.");
      } else {
        const errorText = await pushoverResponse.text();
        console.error(`Pushover delivery failed: ${errorText}`);
      }
    } else {
      console.warn("Pushover credentials missing in environment variables. Skipping notification.");
    }

  } catch (error) {
    console.error("Execution failure:", error);
    process.exit(1);
  }
}

run();
