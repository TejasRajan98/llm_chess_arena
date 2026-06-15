import os
import re

# Paths relative to the repository root
template_path = 'chess_arena/app/templates/index.html'
css_path = 'chess_arena/app/static/css/style.css'
js_path = 'chess_arena/app/static/js/main.js'
output_path = 'index.html'

# Read inputs
with open(template_path, 'r', encoding='utf-8') as f:
    template = f.read()

with open(css_path, 'r', encoding='utf-8') as f:
    css = f.read()

with open(js_path, 'r', encoding='utf-8') as f:
    js = f.read()

# Define the direct Gemini API implementation
direct_gemini_js = """// --- Gemini API ---
const apiKey = "";
async function fetchGeminiContent(promptText, modelPersona = "an expert chess engine", modelName = "Gemini 2.5 Flash") {
    const localKey = localStorage.getItem('user_gemini_api_key') || '';
    const activeKey = localKey || apiKey;
    
    if (!activeKey) {
        throw new Error("GEMINI_API_KEY is not set. Please configure your API key in the sidebar settings or select the 'Local Minimax' engine.");
    }
    
    const modelMapping = {
        "Gemini 2.5 Flash": "gemini-2.5-flash",
        "Gemini 1.5 Pro": "gemini-1.5-pro",
        "Gemini 1.5 Flash": "gemini-1.5-flash"
    };
    const geminiModel = modelMapping[modelName] || "gemini-2.5-flash";
    
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${activeKey}`;
    const payload = {
        contents: [{ parts: [{ text: promptText }] }],
        systemInstruction: {
            parts: [{ text: `You are ${modelPersona}. Read the PGN/FEN and instructions carefully. Output strictly what is asked with no conversational filler.` }]
        }
    };
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const response = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            const result = await response.json();
            if(result.candidates && result.candidates[0]) {
                return result.candidates[0].content.parts[0].text;
            }
        } catch (e) {
            if (e.message.includes("GEMINI_API_KEY")) {
                throw e;
            }
            await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000));
        }
    }
    throw new Error("Failed to reach Gemini API");
}"""

# Replace backend JS implementation with direct client-side implementation
backend_js_pattern = r"// --- Gemini API via Backend ---[\s\S]+?throw new Error\(\"Failed to reach backend API\"\);\s*\}"

js_modified = re.sub(backend_js_pattern, direct_gemini_js, js)

# Build the single file
# 1. Embed CSS (supports optional version query parameters)
compiled = re.sub(r'<link\s+rel="stylesheet"\s+href="/static/css/style\.css(?:\?\S+)?">', f"<style>\n{css}\n</style>", template)
# 2. Embed JS (supports optional version query parameters)
compiled = re.sub(r'<script\s+src="/static/js/main\.js(?:\?\S+)?"></script>', f"<script>\n{js_modified}\n</script>", compiled)

with open(output_path, 'w', encoding='utf-8') as f:
    f.write(compiled)

print("Compiled root index.html successfully!")
